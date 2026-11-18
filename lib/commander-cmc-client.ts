import { fetchScryfall } from '@/packages/data/scryfall-transport';
import {
  isScryfallError,
  resolveCommanderCmcFromCard,
  type ScryfallCardWithCmc,
} from '@/lib/commander-cmc';

const commanderCmcCache = new Map<string, { value: number | null; expiresAt: number }>();
class ScryfallHttpError extends Error {}
function cacheCmc(key: string, value: number | null) {
  if (commanderCmcCache.size >= 500) commanderCmcCache.delete(commanderCmcCache.keys().next().value!);
  commanderCmcCache.set(key, { value, expiresAt: Date.now() + (value === null ? 10_000 : 3_600_000) });
}

function sanitizeCommanderQuery(query: string) {
  return query.trim().replace(/"/g, '');
}

async function fetchScryfallJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const response = await fetchScryfall(url, signal);
  if (response.status === 404) return null;
  if (!response.ok) throw new ScryfallHttpError(`Scryfall request failed (${response.status})`);
  return response.json() as Promise<T>;
}

async function fetchNamedCard(queryText: string, mode: 'exact' | 'fuzzy', signal?: AbortSignal) {
  const card = await fetchScryfallJson<ScryfallCardWithCmc>(
    `https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(queryText)}`,
    signal,
  );
  if (!card || isScryfallError(card)) return null;
  return card;
}

export async function lookupCommanderCmcInBrowser(name: string, signal?: AbortSignal) {
  const queryText = sanitizeCommanderQuery(name);
  if (!queryText) return null;

  const cacheKey = queryText.toLowerCase();
  const cached = commanderCmcCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  commanderCmcCache.delete(cacheKey);

  try {
    let card = await fetchNamedCard(queryText, 'exact', signal);
    if (!card) {
      card = await fetchNamedCard(queryText, 'fuzzy', signal);
    }

    if (!card) {
      const commanderSearch = await fetchScryfallJson<{ data?: ScryfallCardWithCmc[] }>(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`is:commander name:"${queryText}"`)}&unique=cards`,
        signal,
      );
      card = commanderSearch?.data?.[0] || null;
    }

    if (!card) {
      const broadSearch = await fetchScryfallJson<{ data?: ScryfallCardWithCmc[] }>(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(queryText)}&unique=cards`,
        signal,
      );
      card = broadSearch?.data?.[0] || null;
    }

    const cmc = resolveCommanderCmcFromCard(card, queryText);
    cacheCmc(cacheKey, cmc);
    return cmc;
  } catch (error) {
    // CMC is optional metadata: preserve null on HTTP failure, without poisoning
    // the negative cache. Network/abort errors retain their existing contract.
    if (error instanceof ScryfallHttpError) return null;
    throw error;
  }
}

export function primeCommanderCmcCache(entries: Record<string, number | null>) {
  Object.entries(entries).forEach(([name, value]) => {
    cacheCmc(sanitizeCommanderQuery(name).toLowerCase(), value);
  });
}
