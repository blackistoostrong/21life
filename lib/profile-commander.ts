'use client';

// Browser-only public card metadata. No account drafts or user-owned data are cached here.
import { fetchScryfall } from '@/packages/data/scryfall-transport';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { buildDeckColorFields, normalizeDeckColorIdentity } from '@/lib/deck-metadata';
import { buildCommanderNameSearchClause } from '@/lib/commander-search-aliases';
import { getDefaultImportedCommanderOption, repairImportedCommanderOptions, resolveImportedDeckCommanderImage } from '@/lib/deck-importers';
import { delay } from '@/lib/async-utils';
import type { CommanderPartnerMode } from '@/lib/scryfall';
import type { ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

export interface CommanderSearchResult {
  id: string;
  name: string;
  imageUrl: string | null;
  typeLine: string;
  colorIdentity: string[];
  oracleText: string;
  keywords: string[];
}

export interface ImportedCommanderOption {
  name: string;
  imageUrl: string | null;
  colorIdentity?: string[];
}

export interface CommanderArtOption {
  id: string;
  name: string;
  imageUrl: string;
  setName: string;
  collectorNumber: string;
  releasedAt: string | null;
}


export type ManualPartnerMode = CommanderPartnerMode;

interface ScryfallBrowserCard {
  id: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  keywords?: string[];
  color_identity?: string[];
  set_name?: string;
  collector_number?: string;
  released_at?: string;
  image_uris?: {
    art_crop?: string;
    large?: string;
    normal?: string;
  };
  card_faces?: Array<{
    name: string;
    image_uris?: {
      art_crop?: string;
      large?: string;
      normal?: string;
    };
  }>;
}

interface ScryfallBrowserSearchResponse {
  data?: ScryfallBrowserCard[];
}

function expandDeckCommanderNames(commander: string) {
  return Array.from(new Set(
    commander
      .split('//')
      .flatMap((part) => part.split('/').map((name) => name.trim()))
      .filter(Boolean)
  ));
}

export const SCRYFALL_REQUEST_GAP_MS = 120;
const commanderSearchCache = new Map<string, CommanderSearchResult[]>();
const COMMANDER_ART_CACHE_MS = 30 * 24 * 60 * 60 * 1_000;
const COMMANDER_ART_STORAGE_KEY = 'phyrexian-arena:commander-art-options:v7';
const commanderArtCache = new Map<string, { expiresAt: number; options: CommanderArtOption[] }>();
const commanderArtInflight = new Map<string, Promise<CommanderArtOption[]>>();
let commanderArtCacheHydrated = false;

function hydrateCommanderArtCache() {
  if (commanderArtCacheHydrated) return;
  commanderArtCacheHydrated = true;
  try {
    const raw = window.localStorage.getItem(COMMANDER_ART_STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Record<string, { expiresAt: number; options: CommanderArtOption[] }>;
    const now = Date.now();
    Object.entries(stored).forEach(([key, entry]) => {
      if (entry.expiresAt > now && Array.isArray(entry.options)) {
        commanderArtCache.set(key, entry);
      }
    });
  } catch {
    // Storage may be unavailable; memory cache still works.
  }
}

function rememberCommanderArts(key: string, options: CommanderArtOption[]) {
  commanderArtCache.set(key, {
    expiresAt: Date.now() + COMMANDER_ART_CACHE_MS,
    options,
  });
  try {
    window.localStorage.setItem(
      COMMANDER_ART_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(commanderArtCache)),
    );
  } catch {
    // Storage quota/private mode: memory cache still works.
  }
}

async function lookupCommanderImageFromBrowser(name: string): Promise<string | null> {
  const match = await lookupCommanderFromBrowser(name);
  return match?.imageUrl?.trim() || null;
}

export async function normalizeImportedDeckPreview(deck: ImportedDeckPreview): Promise<ImportedDeckPreview> {
  const options = deck.commanderOptions || [];
  let repairedOptions = options;

  if (options.length > 1) {
    repairedOptions = await repairImportedCommanderOptions(options, lookupCommanderImageFromBrowser);
  } else if (options.length === 1 && !options[0]?.imageUrl?.trim()) {
    const imageUrl = await lookupCommanderImageFromBrowser(options[0].name);
    if (imageUrl) {
      repairedOptions = [{ ...options[0], imageUrl }];
    }
  } else if (options.length === 0 && !deck.commanderImageUrl?.trim()) {
    const imageUrl = await lookupCommanderImageFromBrowser(deck.commander);
    if (imageUrl) {
      return {
        ...deck,
        commanderImageUrl: imageUrl,
        commanderOptions: [{
          name: deck.commander,
          imageUrl,
          colorIdentity: deck.colorIdentity || [],
        }],
      };
    }
    return deck;
  }

  const defaultCommander = getDefaultImportedCommanderOption({
    ...deck,
    commanderOptions: repairedOptions,
  });

  return {
    ...deck,
    commanderOptions: repairedOptions,
    commanderImageUrl: defaultCommander.imageUrl || deck.commanderImageUrl,
  };
}

export async function resolveImportedDeckCommanderImageForSave(
  selectedCommander: ImportedCommanderOption,
  deck: ImportedDeckPreview,
  preserveImage?: string | null,
): Promise<string | null> {
  let imageUrl = resolveImportedDeckCommanderImage(selectedCommander, deck, { preserveImage });
  if (!imageUrl) {
    imageUrl = await lookupCommanderImageFromBrowser(selectedCommander.name);
    await delay(SCRYFALL_REQUEST_GAP_MS);
  }

  return imageUrl;
}

function getCommanderSearchCacheKey(query: string, partnerMode: ManualPartnerMode | null = null) {
  return `${partnerMode || 'any'}:${query.trim().toLowerCase()}`;
}

async function lookupCommanderFromBrowser(name: string, signal?: AbortSignal): Promise<CommanderSearchResult | null> {
  const queryText = sanitizeScryfallQuery(name);
  if (!queryText) return null;

  const request = (path: string) => fetchScryfall(`https://api.scryfall.com/cards/named?${path}=${encodeURIComponent(queryText)}`, signal);

  const exactResponse = await request('exact');
  if (exactResponse.ok) {
    return toCommanderSearchResult(await exactResponse.json() as ScryfallBrowserCard);
  }

  const fuzzyResponse = await request('fuzzy');
  if (fuzzyResponse.ok) {
    return toCommanderSearchResult(await fuzzyResponse.json() as ScryfallBrowserCard);
  }

  return null;
}

export async function resolveCommanderColorOptions(
  commander: string,
  existingOptions: ImportedCommanderOption[] = [],
  signal?: AbortSignal
): Promise<ImportedCommanderOption[]> {
  const commanderNames = expandDeckCommanderNames(commander);
  const resolved: ImportedCommanderOption[] = [];

  for (const name of commanderNames) {
    const existing = existingOptions.find((option) => option.name.toLowerCase() === name.toLowerCase());
    if (existing?.colorIdentity && existing.colorIdentity.length > 0) {
      resolved.push(existing);
      continue;
    }

    const match = await lookupCommanderFromBrowser(name, signal);
    resolved.push(match ? {
      name: match.name,
      imageUrl: existing?.imageUrl ?? match.imageUrl,
      colorIdentity: normalizeDeckColorIdentity(match.colorIdentity),
    } : (existing || { name, imageUrl: null, colorIdentity: [] }));

    await delay(SCRYFALL_REQUEST_GAP_MS, signal);
  }

  return uniqueCommanderOptions(resolved.filter((option) => option.name));
}



function sanitizeScryfallQuery(query: string) {
  return query.trim().replace(/"/g, '');
}

function extractBrowserScryfallImage(card: ScryfallBrowserCard, preferredName?: string): string | null {
  if (preferredName) {
    const normalizedName = preferredName.toLowerCase();
    const matchingFace = card.card_faces?.find((face) => face.name.toLowerCase() === normalizedName);
    if (matchingFace?.image_uris?.art_crop) return matchingFace.image_uris.art_crop;
    if (matchingFace?.image_uris?.large) return matchingFace.image_uris.large;
    if (matchingFace?.image_uris?.normal) return matchingFace.image_uris.normal;
  }

  if (card.image_uris?.art_crop) return card.image_uris.art_crop;
  if (card.card_faces?.[0]?.image_uris?.art_crop) return card.card_faces[0].image_uris.art_crop;
  if (card.image_uris?.large) return card.image_uris.large;
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (card.card_faces?.[0]?.image_uris?.large) return card.card_faces[0].image_uris.large;
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal;
  return null;
}

function scryfallPartnerModeQuery(mode: ManualPartnerMode | null) {
  if (mode === 'background') return 'is:commander t:background';
  if (mode === 'background-owner') return 'is:commander o:"choose a background"';
  if (mode === 'friends') return 'is:commander o:"friends forever"';
  if (mode === 'father-son') return 'is:commander o:"partner—father & son"';
  if (mode === 'survivors') return 'is:commander o:"partner—survivors"';
  if (mode === 'character-select') return 'is:commander o:"partner—character select"';
  if (mode === 'doctor') return 'is:commander t:doctor t:"time lord"';
  if (mode === 'doctor-companion') return 'is:commander o:"doctor\'s companion"';
  if (mode?.startsWith('partner-with:')) {
    const partnerName = sanitizeScryfallQuery(mode.slice('partner-with:'.length));
    return partnerName ? `is:commander !"${partnerName}"` : 'is:commander o:"partner with"';
  }
  if (mode?.startsWith('partner-family:')) {
    const familyName = sanitizeScryfallQuery(mode.slice('partner-family:'.length));
    return familyName ? `is:commander o:"partner—${familyName}"` : 'is:commander';
  }
  if (mode === 'partner') return 'is:commander o:partner -o:"partner with" -o:"partner—"';
  return 'is:commander';
}

function toCommanderSearchResult(card: ScryfallBrowserCard): CommanderSearchResult {
  return {
    id: card.id,
    name: card.name,
    imageUrl: extractBrowserScryfallImage(card),
    typeLine: card.type_line || '',
    colorIdentity: normalizeDeckColorIdentity(card.color_identity),
    oracleText: card.oracle_text || '',
    keywords: Array.isArray(card.keywords) ? card.keywords : [],
  };
}

async function fetchScryfallCommandersFromBrowser(
  query: string,
  partnerMode: ManualPartnerMode | null = null,
  signal?: AbortSignal
) {
  const queryText = sanitizeScryfallQuery(query);
  if (queryText.length < 2) return [];

  const baseQuery = scryfallPartnerModeQuery(partnerMode);
  const response = await fetchScryfall(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`${baseQuery} ${buildCommanderNameSearchClause(queryText)}`)}&order=edhrec&unique=cards`,
    signal
  );

  if (response.status === 404) return [];
  if (!response.ok) throw new Error('Scryfall search failed');

  const data = await response.json() as ScryfallBrowserSearchResponse;
  return (data.data || []).slice(0, 20).map(toCommanderSearchResult);
}

export async function fetchCommanderSearchResults(
  query: string,
  partnerMode: ManualPartnerMode | null = null,
  signal?: AbortSignal
) {
  const cacheKey = getCommanderSearchCacheKey(query, partnerMode);
  const cached = commanderSearchCache.get(cacheKey);
  if (cached) return cached;

  let results: CommanderSearchResult[] = [];

  try {
    results = await fetchScryfallCommandersFromBrowser(query, partnerMode, signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    results = [];
  }

  if (results.length === 0) {
    const params = new URLSearchParams({ q: query });
    if (partnerMode) params.set('partnerMode', partnerMode);
    const response = await authenticatedFetch(`/api/scryfall-commanders?${params.toString()}`, { signal });
    if (response.ok) {
      const data = await response.json();
      results = Array.isArray(data.data) ? data.data as CommanderSearchResult[] : [];
    }
  }

  commanderSearchCache.set(cacheKey, results);
  return results;
}

export async function fetchScryfallArtOptionsFromBrowser(commanderName: string) {
  const queryText = sanitizeScryfallQuery(commanderName);
  if (queryText.length < 2) return [];
  hydrateCommanderArtCache();
  const cacheKey = queryText.toLocaleLowerCase();
  const cached = commanderArtCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.options;

  const inflight = commanderArtInflight.get(cacheKey);
  if (inflight) return inflight;

  const request = (async () => {
    const response = await fetchScryfall(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${queryText}"`)}&unique=art&order=released`
    );

    if (response.status === 404) return [];
    if (!response.ok) throw new Error('Scryfall art search failed');

    const data = await response.json() as ScryfallBrowserSearchResponse;
    const options = (data.data || [])
      .map((card) => {
        const imageUrl = extractBrowserScryfallImage(card, queryText);
        if (!imageUrl) return null;

        return {
          id: card.id,
          name: card.name,
          imageUrl,
          setName: card.set_name || '',
          collectorNumber: card.collector_number || '',
          releasedAt: card.released_at || null,
        };
      })
      .filter((option): option is CommanderArtOption => Boolean(option));

    rememberCommanderArts(cacheKey, options);
    return options;
  })();

  commanderArtInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    commanderArtInflight.delete(cacheKey);
  }
}

export function manualDeckColorFields(commander: CommanderSearchResult, partnerCommander?: CommanderSearchResult | null) {
  const commanderOptions = uniqueCommanderOptions([
    {
      name: commander.name,
      imageUrl: commander.imageUrl,
      colorIdentity: normalizeDeckColorIdentity(commander.colorIdentity),
    },
    ...(partnerCommander ? [{
      name: partnerCommander.name,
      imageUrl: partnerCommander.imageUrl,
      colorIdentity: normalizeDeckColorIdentity(partnerCommander.colorIdentity),
    }] : []),
  ]);
  return buildDeckColorFields(commanderOptions);
}

export function uniqueCommanderOptions(options: ImportedCommanderOption[]) {
  return options.filter((option, index, allOptions) =>
    option.name &&
    allOptions.findIndex((candidate) => candidate.name.toLowerCase() === option.name.toLowerCase()) === index
  );
}

