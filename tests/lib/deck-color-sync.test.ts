import { describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { resolveDeckCommanderColors, syncDeckCommanderColors } from '@/lib/deck-color-sync';

vi.mock('@/lib/authenticated-fetch', () => ({ authenticatedFetch: vi.fn() }));

describe('arena color resolution without external imports', () => {
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
