import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ scryfall: vi.fn(), authenticated: vi.fn(), delay: vi.fn() }));
vi.mock('@/packages/data/scryfall-transport', () => ({ fetchScryfall: io.scryfall }));
vi.mock('@/lib/authenticated-fetch', () => ({ authenticatedFetch: io.authenticated }));
vi.mock('@/lib/async-utils', () => ({ delay: io.delay }));
const load = () => import('@/lib/profile-commander');
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const card = (name = 'Fixture Commander') => ({ id: name, name, color_identity: ['U'],
  image_uris: { art_crop: `https://cards.scryfall.io/${name}.jpg` },
  type_line: 'Legendary Creature', oracle_text: 'Partner', keywords: ['Partner'] });
const preview = () => ({ name: 'Deck', commander: 'Fixture Commander', commanderImageUrl: null,
  bracket: null, sourceUrl: 'https://archidekt.com/decks/1', sourceType: 'archidekt' });

beforeEach(() => {
  vi.resetModules();
  io.scryfall.mockReset(); io.authenticated.mockReset(); io.delay.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('profile public commander metadata adapter', () => {
  it('maps public card fields, caps results and caches normalized searches separately by partner mode', async () => {
    io.scryfall.mockImplementation(async () => response({ data: Array.from({ length: 25 }, (_, i) => card('Card ' + i)) }));
    const api = await load();
    const results = await api.fetchCommanderSearchResults('  Fixture  ');
    expect(results).toHaveLength(20);
    expect(results[0]).toMatchObject({ name: 'Card 0', colorIdentity: ['U'], oracleText: 'Partner', keywords: ['Partner'] });
    expect(await api.fetchCommanderSearchResults('fixture')).toBe(results);
    expect(io.scryfall).toHaveBeenCalledTimes(1);
    await api.fetchCommanderSearchResults('fixture', 'background');
    const query = new URL(io.scryfall.mock.calls[1][0]).searchParams.get('q');
    expect(query).toContain('is:commander t:background');
    expect(io.authenticated).not.toHaveBeenCalled();
  });

  it('uses authenticated fallback for a public miss and forwards cancellation', async () => {
    io.scryfall.mockResolvedValue(response({}, 404));
    io.authenticated.mockResolvedValue(response({ data: [{ name: 'Fallback' }] }));
    const signal = new AbortController().signal;
    const api = await load();
    expect(await api.fetchCommanderSearchResults('A name', 'partner', signal)).toEqual([{ name: 'Fallback' }]);
    expect(io.authenticated).toHaveBeenCalledWith('/api/scryfall-commanders?q=A+name&partnerMode=partner', { signal });
  });

  it('propagates abort without trying fallback or poisoning the search cache', async () => {
    const abort = new Error('Operation aborted'); abort.name = 'AbortError';
    io.scryfall.mockRejectedValueOnce(abort).mockResolvedValueOnce(response({ data: [card()] }));
    const api = await load();
    await expect(api.fetchCommanderSearchResults('Fixture')).rejects.toBe(abort);
    expect(io.authenticated).not.toHaveBeenCalled();
    expect(await api.fetchCommanderSearchResults('Fixture')).toHaveLength(1);
  });

  it('falls back after a public transport error and tolerates an invalid fallback list', async () => {
    io.scryfall.mockRejectedValue(new Error('Offline'));
    io.authenticated.mockResolvedValue(response({ data: null }));
    expect(await (await load()).fetchCommanderSearchResults('Fixture')).toEqual([]);
  });

  it('preserves partner search constraints including quoted named partners', async () => {
    io.scryfall.mockImplementation(async () => response({ data: [card()] }));
    const api = await load();
    for (const mode of ['friends', 'doctor', 'partner-with:Named Partner'] as const) {
      await api.fetchCommanderSearchResults('Fixture', mode);
    }
    const queries = io.scryfall.mock.calls.map(([url]) => new URL(url).searchParams.get('q'));
    expect(queries[0]).toContain('friends forever');
    expect(queries[1]).toContain('t:doctor t:"time lord"');
    expect(queries[2]).toContain('!"Named Partner"');
  });

  it('coalesces art requests, chooses the matching DFC face and retains printing metadata', async () => {
    let release!: (value: Response) => void;
    io.scryfall.mockReturnValue(new Promise<Response>(resolve => { release = resolve; }));
    const api = await load();
    const first = api.fetchScryfallArtOptionsFromBrowser('Back Face');
    const second = api.fetchScryfallArtOptionsFromBrowser('back face');
    expect(io.scryfall).toHaveBeenCalledTimes(1);
    release(response({ data: [{ id: 'dfc', name: 'Front Face // Back Face', set_name: 'Fixture Set',
      collector_number: '7', released_at: '2026-01-01', image_uris: { art_crop: 'front.jpg' },
      card_faces: [{ name: 'Back Face', image_uris: { normal: 'back.jpg' } }] }, { id: 'missing', name: 'No art' }] }));
    const result = await first;
    expect(await second).toBe(result);
    expect(result).toEqual([{ id: 'dfc', name: 'Front Face // Back Face', imageUrl: 'back.jpg',
      setName: 'Fixture Set', collectorNumber: '7', releasedAt: '2026-01-01' }]);
    expect(await api.fetchScryfallArtOptionsFromBrowser('Back Face')).toBe(result);
  });

  it('loads only unexpired art entries from the existing browser storage key', async () => {
    const options = [{ id: 'stored', name: 'Stored', imageUrl: 'stored.jpg', setName: '', collectorNumber: '', releasedAt: null }];
    const getItem = vi.fn(() => JSON.stringify({ stored: { expiresAt: Date.now() + 60000, options },
      expired: { expiresAt: Date.now() - 1, options } }));
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { getItem, setItem } });
    io.scryfall.mockResolvedValue(response({ data: [card('Expired')] }));
    const api = await load();
    expect(await api.fetchScryfallArtOptionsFromBrowser('Stored')).toEqual(options);
    expect(getItem).toHaveBeenCalledWith('phyrexian-arena:commander-art-options:v7');
    expect(io.scryfall).not.toHaveBeenCalled();
    expect(await api.fetchScryfallArtOptionsFromBrowser('Expired')).toHaveLength(1);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('keeps memory caching when browser storage is corrupt or unavailable', async () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '{invalid', setItem: () => { throw new Error('Quota'); } } });
    io.scryfall.mockResolvedValue(response({ data: [card()] }));
    const api = await load();
    const result = await api.fetchScryfallArtOptionsFromBrowser('Fixture');
    expect(await api.fetchScryfallArtOptionsFromBrowser('Fixture')).toBe(result);
    expect(io.scryfall).toHaveBeenCalledTimes(1);
  });

  it('releases failed in-flight art requests for retry and treats missing prints as optional', async () => {
    io.scryfall.mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response({}, 404));
    const api = await load();
    await expect(api.fetchScryfallArtOptionsFromBrowser('Fixture')).rejects.toThrow('Scryfall art search failed');
    expect(await api.fetchScryfallArtOptionsFromBrowser('Fixture')).toEqual([]);
    expect(await api.fetchScryfallArtOptionsFromBrowser('A')).toEqual([]);
    expect(io.scryfall).toHaveBeenCalledTimes(2);
  });

  it('repairs an imported preview without changing source or mutating the input', async () => {
    io.scryfall.mockResolvedValue(response(card()));
    const original = preview();
    const result = await (await load()).normalizeImportedDeckPreview(original);
    expect(result.commanderOptions?.[0]).toMatchObject({ name: original.commander, imageUrl: expect.any(String) });
    expect(result.sourceUrl).toBe(original.sourceUrl);
    expect(original.commanderImageUrl).toBeNull();
    expect(original).not.toHaveProperty('commanderOptions');
  });

  it('falls back from exact to fuzzy lookup while retaining unknown commander metadata', async () => {
    io.scryfall.mockResolvedValue(response({}, 404));
    const api = await load();
    const existing = [{ name: 'Unknown', imageUrl: 'keep.jpg' }];
    expect(await api.resolveCommanderColorOptions('Known // Unknown', [
      { name: 'Known', imageUrl: null, colorIdentity: ['R'] }, ...existing,
    ])).toEqual([{ name: 'Known', imageUrl: null, colorIdentity: ['R'] }, ...existing]);
    expect(io.scryfall.mock.calls.map(([url]) => new URL(url).searchParams.has('fuzzy'))).toEqual([false, true]);
  });

  it('keeps an existing selected image on save and only looks up a missing image', async () => {
    io.scryfall.mockResolvedValue(response(card()));
    const api = await load();
    expect(await api.resolveImportedDeckCommanderImageForSave({ name: 'Fixture Commander', imageUrl: 'selected.jpg' }, preview())).toBe('selected.jpg');
    expect(io.scryfall).not.toHaveBeenCalled();
    expect(await api.resolveImportedDeckCommanderImageForSave({ name: 'Fixture Commander', imageUrl: null }, preview())).toContain('Fixture Commander.jpg');
    expect(io.delay).toHaveBeenCalledWith(120);
  });

  it('combines commander colors and deduplicates options without dropping first-choice images', async () => {
    const api = await load();
    const primary = { id: 'a', name: 'Primary', imageUrl: 'a.jpg', typeLine: '', colorIdentity: ['U'], oracleText: '', keywords: [] };
    expect(api.manualDeckColorFields(primary, { ...primary, id: 'b', name: 'Partner', colorIdentity: ['R'] }))
      .toMatchObject({ color_identity: ['U', 'R'], commander_options: [{ name: 'Primary' }, { name: 'Partner' }] });
    expect(api.uniqueCommanderOptions([{ name: 'Same', imageUrl: 'first.jpg' }, { name: 'same', imageUrl: null }]))
      .toEqual([{ name: 'Same', imageUrl: 'first.jpg' }]);
  });
});
