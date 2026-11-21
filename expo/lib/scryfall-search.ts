import { fetchScryfall } from '../../packages/data/scryfall-transport';
import type { CommanderArtOption, CommanderPartnerMode, CommanderSearchResult } from '@/lib/commander-types';
import { buildCommanderNameSearchClause } from '@/lib/commander-search-aliases';
import { normalizeDeckColorIdentity } from '@/lib/deck-metadata';

export type ScryfallCard = {
  id: string;
  name: string;
  type_line?: string;
  color_identity?: string[];
  oracle_text?: string;
  keywords?: string[];
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
};

type ScryfallSearchResponse = {
  data?: ScryfallCard[];
};

function sanitizeCommanderQuery(query: string): string {
  return query.trim().replace(/"/g, '');
}

function partnerModeQuery(mode: CommanderPartnerMode | null): string {
  if (mode === 'background') return 'is:commander t:background';
  if (mode === 'background-owner') return 'is:commander o:"choose a background"';
  if (mode === 'friends') return 'is:commander o:"friends forever"';
  if (mode === 'father-son') return 'is:commander o:"partner—father & son"';
  if (mode === 'survivors') return 'is:commander o:"partner—survivors"';
  if (mode === 'character-select') return 'is:commander o:"partner—character select"';
  if (mode === 'doctor') return 'is:commander t:doctor t:"time lord"';
  if (mode === 'doctor-companion') return 'is:commander o:"doctor\'s companion"';
  if (mode?.startsWith('partner-with:')) {
    const partnerName = sanitizeCommanderQuery(mode.slice('partner-with:'.length));
    return partnerName ? `is:commander !"${partnerName}"` : 'is:commander o:"partner with"';
  }
  if (mode?.startsWith('partner-family:')) {
    const familyName = sanitizeCommanderQuery(mode.slice('partner-family:'.length));
    return familyName ? `is:commander o:"partner—${familyName}"` : 'is:commander';
  }
  if (mode === 'partner') return 'is:commander o:partner -o:"partner with" -o:"partner—"';
  return 'is:commander';
}

function extractScryfallImage(card: ScryfallCard): string | null {
  if (card.image_uris?.art_crop) return card.image_uris.art_crop;
  if (card.card_faces?.[0]?.image_uris?.art_crop) return card.card_faces[0].image_uris.art_crop;
  if (card.image_uris?.large) return card.image_uris.large;
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (card.card_faces?.[0]?.image_uris?.large) return card.card_faces[0].image_uris.large;
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal;
  return null;
}

export function extractScryfallImageForName(card: ScryfallCard, preferredName: string): string | null {
  const normalizedName = preferredName.trim().toLowerCase();
  const matchingFace = card.card_faces?.find((face) => face.name.trim().toLowerCase() === normalizedName);
  if (matchingFace?.image_uris?.art_crop) return matchingFace.image_uris.art_crop;
  if (matchingFace?.image_uris?.large) return matchingFace.image_uris.large;
  if (matchingFace?.image_uris?.normal) return matchingFace.image_uris.normal;
  return extractScryfallImage(card);
}

function toCommanderSearchResult(card: ScryfallCard): CommanderSearchResult {
  return {
    id: card.id,
    name: card.name,
    imageUrl: extractScryfallImage(card),
    typeLine: card.type_line || '',
    colorIdentity: normalizeDeckColorIdentity(card.color_identity),
    oracleText: card.oracle_text || '',
    keywords: Array.isArray(card.keywords) ? card.keywords : [],
  };
}

export function buildScryfallCommanderSearchUrl(
  query: string,
  partnerMode: CommanderPartnerMode | null = null,
): string | null {
  const queryText = sanitizeCommanderQuery(query);
  if (queryText.length < 2) return null;

  const baseQuery = partnerModeQuery(partnerMode);
  const scryfallQuery = `${baseQuery} ${buildCommanderNameSearchClause(queryText)}`;
  return `https://api.scryfall.com/cards/search?q=${encodeURIComponent(scryfallQuery)}&order=edhrec&unique=cards`;
}

export async function searchCommandersDirect(
  query: string,
  partnerMode: CommanderPartnerMode | null = null,
  signal?: AbortSignal,
): Promise<CommanderSearchResult[]> {
  const url = buildScryfallCommanderSearchUrl(query, partnerMode);
  if (!url) return [];

  const response = await fetchScryfall(url, signal);
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`Scryfall search failed (${response.status})`);
  }

  const payload = await response.json() as ScryfallSearchResponse;
  return (payload.data || []).slice(0, 20).map(toCommanderSearchResult);
}

export function buildScryfallArtSearchUrl(commanderName: string): string | null {
  const queryText = sanitizeCommanderQuery(commanderName);
  if (queryText.length < 2) return null;
  return `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${queryText}"`)}&unique=art&order=released`;
}

export async function fetchCommanderArtOptionsDirect(
  commanderName: string,
  signal?: AbortSignal,
): Promise<CommanderArtOption[]> {
  const url = buildScryfallArtSearchUrl(commanderName);
  if (!url) return [];

  const queryText = sanitizeCommanderQuery(commanderName);
  const response = await fetchScryfall(url, signal);
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`Scryfall art search failed (${response.status})`);
  }

  const payload = await response.json() as ScryfallSearchResponse;
  return (payload.data || [])
    .map((card) => {
      const imageUrl = extractScryfallImageForName(card, queryText);
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
}
