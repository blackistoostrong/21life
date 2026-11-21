import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildScryfallArtSearchUrl,
  buildScryfallCommanderSearchUrl,
  extractScryfallImageForName,
  fetchCommanderArtOptionsDirect,
  searchCommandersDirect,
} from '@/lib/scryfall-search';

describe('scryfall-search', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a commander search URL for partial names', () => {
    const url = buildScryfallCommanderSearchUrl('tymna');
    expect(url).toContain('api.scryfall.com/cards/search');
    expect(decodeURIComponent(url || '')).toContain('tymna');
    expect(decodeURIComponent(url || '')).toContain('is:commander');
  });

  it('returns null for very short queries', () => {
    expect(buildScryfallCommanderSearchUrl('a')).toBeNull();
  });

  it('adds partner mode filters to the query', () => {
    const url = buildScryfallCommanderSearchUrl('thrasios', 'partner');
    expect(decodeURIComponent(url || '')).toContain('o:partner');
  });

  it('supports named and grouped partner variants', () => {
    expect(decodeURIComponent(buildScryfallCommanderSearchUrl('rock', 'partner-with:Rocksteady, Mutant Marauder') || ''))
      .toContain('!"Rocksteady, Mutant Marauder"');
    expect(decodeURIComponent(buildScryfallCommanderSearchUrl('leo', 'character-select') || ''))
      .toContain('partner—character select');
    expect(decodeURIComponent(buildScryfallCommanderSearchUrl('new', 'partner-family:Future team') || ''))
      .toContain('partner—Future team');
  });

  it('resolves original Friends forever printed names through canonical aliases', () => {
    const url = decodeURIComponent(buildScryfallCommanderSearchUrl('Eleven') || '');
    expect(url).toContain('name:"Cecily, Haunted Mage"');
  });

  it('builds an exact-art search URL for commander printings', () => {
    const url = buildScryfallArtSearchUrl('Tymna the Weaver');
    expect(url).toContain('api.scryfall.com/cards/search');
    expect(decodeURIComponent(url || '')).toContain('!"Tymna the Weaver"');
    expect(url).toContain('unique=art');
  });

  it('selects the matching face art for a double-faced commander', () => {
    const card = {
      id: 'eirdu-isilu',
      name: 'Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight',
      card_faces: [
        { name: 'Eirdu, Carrier of Dawn', image_uris: { art_crop: 'https://img/eirdu.jpg' } },
        { name: 'Isilu, Carrier of Twilight', image_uris: { art_crop: 'https://img/isilu.jpg' } },
      ],
    };

    expect(extractScryfallImageForName(card, 'Eirdu, Carrier of Dawn')).toBe('https://img/eirdu.jpg');
    expect(extractScryfallImageForName(card, 'Isilu, Carrier of Twilight')).toBe('https://img/isilu.jpg');
  });

  it('retries a rate-limited art request instead of returning an empty list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', {
        status: 429,
        headers: { 'retry-after': '0.001' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: 'tymna-print',
          name: 'Tymna the Weaver',
          image_uris: { art_crop: 'https://img/tymna.jpg' },
        }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const arts = await fetchCommanderArtOptionsDirect('Tymna the Weaver');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(arts.map((art) => art.imageUrl)).toEqual(['https://img/tymna.jpg']);
  });

  it('caps commander results and normalizes missing metadata and face images', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [
      { id: 'face', name: 'Face commander', color_identity: ['U', 'U', 'bad'],
        card_faces: [{ image_uris: { art_crop: 'https://img/face.jpg' } }] },
      ...Array.from({ length: 22 }, (_, i) => ({ id: String(i), name: `Commander ${i}` })),
    ] }))));
    const results = await searchCommandersDirect('Mapping fixture');
    expect(results).toHaveLength(20);
    expect(results[0]).toEqual({ id: 'face', name: 'Face commander', colorIdentity: ['U'],
      imageUrl: 'https://img/face.jpg', typeLine: '', oracleText: '', keywords: [] });
    expect(results[1].imageUrl).toBeNull();
  });

  it('distinguishes not-found searches from provider errors', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchCommandersDirect('Not found fixture')).resolves.toEqual([]);
    await expect(searchCommandersDirect('Forbidden fixture')).rejects.toThrow('403');
    await expect(searchCommandersDirect('a')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('excludes printings without images and preserves empty/error states', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [
      { id: 'missing', name: 'No art' },
      { id: 'normal', name: 'Normal art', image_uris: { normal: 'https://img/normal.jpg' } },
    ] }))).mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchCommanderArtOptionsDirect('Art mapping fixture')).resolves.toEqual([
      { id: 'normal', name: 'Normal art', imageUrl: 'https://img/normal.jpg', setName: '', collectorNumber: '', releasedAt: null },
    ]);
    await expect(fetchCommanderArtOptionsDirect('No art fixture')).resolves.toEqual([]);
    await expect(fetchCommanderArtOptionsDirect('Forbidden art fixture')).rejects.toThrow('403');
    await expect(fetchCommanderArtOptionsDirect('a')).resolves.toEqual([]);
  });
});
