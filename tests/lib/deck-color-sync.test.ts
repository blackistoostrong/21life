import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { resolveCommanderColorOptions, resolveDeckColorFields, resolveDeckCommanderColors, syncDeckCommanderColors, syncDecksColorMetadata } from '@/lib/deck-color-sync';
import { fetchScryfall } from '@/packages/data/scryfall-transport';

vi.mock('@/packages/data/scryfall-transport', () => ({ fetchScryfall: vi.fn() }));

vi.mock('@/lib/authenticated-fetch', () => ({ authenticatedFetch: vi.fn() }));

describe('color enrichment cancellation contract', () => {
  const deck = { id: 'imported', user_id: 'owner', commander: 'Talrand, Sky Summoner', source_type: 'archidekt', source_url: 'https://archidekt.com/decks/1', color_identity: null };
  beforeEach(() => { vi.mocked(authenticatedFetch).mockReset(); vi.mocked(fetchScryfall).mockReset(); });
  it('honors cancellation even for cache hits and empty batches', async () => {
    const controller = new AbortController(); controller.abort();
    const signal = controller.signal;
    await expect(resolveDeckCommanderColors({ ...deck, color_identity: ['U'] }, signal)).rejects.toThrow();
    await expect(syncDeckCommanderColors([], {}, 0, signal)).rejects.toThrow();
    await expect(resolveCommanderColorOptions(deck.commander, [], signal)).rejects.toThrow();
    await expect(resolveDeckColorFields(deck, signal)).rejects.toThrow();
    await expect(syncDecksColorMetadata([], undefined, signal)).rejects.toThrow();
    expect(authenticatedFetch).not.toHaveBeenCalled(); expect(fetchScryfall).not.toHaveBeenCalled();
  });
  it('does not fall back or start the next deck after a cancelled import body', async () => {
    const controller = new AbortController();
    vi.mocked(authenticatedFetch).mockImplementation(async (_url, options) => {
      expect(options?.signal).toBe(controller.signal); controller.abort();
      return Response.json({ colorIdentity: ['U'] });
    });
    await expect(syncDeckCommanderColors([deck, { ...deck, id: 'next' }], {}, 2, controller.signal)).rejects.toThrow();
    expect(authenticatedFetch).toHaveBeenCalledTimes(1); expect(fetchScryfall).not.toHaveBeenCalled();
  });
  it('does not start fuzzy lookup after Scryfall cancellation', async () => {
    const controller = new AbortController();
    vi.mocked(fetchScryfall).mockImplementation(async (_url, signal) => {
      expect(signal).toBe(controller.signal); controller.abort(); return new Response(null, { status: 404 });
    });
    await expect(resolveCommanderColorOptions(deck.commander, [], controller.signal)).rejects.toThrow();
    expect(fetchScryfall).toHaveBeenCalledTimes(1);
  });
  it('never persists color fields from a cancelled command', async () => {
    const controller = new AbortController(); const persist = vi.fn();
    vi.mocked(authenticatedFetch).mockImplementation(async () => { controller.abort(); return Response.json({ colorIdentity: ['U'] }); });
    await expect(syncDecksColorMetadata([deck], persist, controller.signal)).rejects.toThrow();
    expect(persist).not.toHaveBeenCalled(); expect(fetchScryfall).not.toHaveBeenCalled();
  });
  it('preserves ordinary fallback and advances past ordinary lookup failures', async () => {
    vi.mocked(authenticatedFetch).mockRejectedValue(new Error('Ordinary import outage'));
    vi.mocked(fetchScryfall).mockResolvedValue(Response.json({ id: 'card', name: deck.commander, color_identity: ['U'] }));
    expect(await resolveDeckCommanderColors(deck, new AbortController().signal)).toEqual(['U']);
    vi.mocked(fetchScryfall).mockRejectedValue(new Error('Ordinary lookup outage'));
    expect(Array.from(await syncDeckCommanderColors([deck, { ...deck, id: 'known', color_identity: ['G'] }]))).toEqual([['known', ['G']]]);
  });
});

describe('arena color resolution without external imports', () => {
  beforeEach(() => { vi.mocked(authenticatedFetch).mockReset(); vi.mocked(fetchScryfall).mockReset(); });
  it('reuses cached colors, skips unidentified decks and respects the batch cap', async () => {
    const deck = { commander: '', source_type: null, source_url: null, color_identity: null };
    const result = await syncDeckCommanderColors([
      { ...deck, id: 'cached' }, { ...deck, id: 'unidentified' },
      { ...deck, id: 'outside-batch', commander: 'Must not be imported', source_type: 'archidekt', source_url: 'https://example.test/deck' },
    ], { cached: ['U'] }, 2);
    expect(Array.from(result)).toEqual([['cached', ['U']]]);
    expect(authenticatedFetch).not.toHaveBeenCalled();
  });

  it('normalizes known identity without network lookup and accepts an empty batch', async () => {
    expect(await resolveDeckCommanderColors({ id: 'known', commander: 'Known', source_type: 'archidekt',
      source_url: 'https://example.test/deck', color_identity: ['U', 'U'] })).toEqual(['U']);
    expect(await syncDeckCommanderColors([], {}, 0)).toEqual(new Map());
    expect(authenticatedFetch).not.toHaveBeenCalled();
  });
});
