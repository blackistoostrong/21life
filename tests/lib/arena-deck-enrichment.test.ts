import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildArenaColorTargets, persistArenaEnrichment, sameArenaEnrichmentSource } from '@/lib/arena-deck-enrichment';
import type { Deck } from '@/lib/types/arena-catalog';
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
const deck: Deck = { id: 'deck', user_id: 'user', group_id: null, name: 'Deck', commander: 'Talrand', commander_image: null,
  bracket: null, source_type: 'archidekt', source_url: 'https://archidekt.com/decks/1', color_identity: null, is_favorite: false, created_at: '2026-11-19' };
function query(data: unknown, error: unknown = null) {
  const q = { update: vi.fn(), eq: vi.fn(), is: vi.fn(), select: vi.fn(), abortSignal: vi.fn() };
  Object.values(q).forEach(fn => fn.mockReturnValue(q)); q.abortSignal.mockResolvedValue({ data, error }); from.mockReturnValue(q); return q;
}
describe('arena enrichment acknowledgements', () => {
  beforeEach(() => from.mockReset());
  it('invalidates every changed source field while retaining unrelated favorite changes', () => {
    for (const field of ['id', 'user_id', 'group_id', 'name', 'commander', 'commander_image', 'bracket', 'source_type', 'source_url'] as const) {
      expect(sameArenaEnrichmentSource({ ...deck, [field]: 'new' }, deck)).toBe(false);
    }
    expect(sameArenaEnrichmentSource({ ...deck, is_favorite: true }, deck)).toBe(true);
  });
  it('requires one acknowledged row and guards all source fields in the private update', async () => {
    const q = query([{ id: deck.id }]);
    expect(await persistArenaEnrichment(deck, { commander_image: 'image' }, new AbortController().signal)).toBe(true);
    for (const field of ['id', 'user_id', 'name', 'commander', 'source_url', 'source_type'] as const) expect(q.eq).toHaveBeenCalledWith(field, deck[field]);
    for (const field of ['group_id', 'commander_image', 'bracket']) expect(q.is).toHaveBeenCalledWith(field, null);
    expect(q.select).toHaveBeenCalledWith('id');
    query([]); expect(await persistArenaEnrichment(deck, { bracket: '3' }, new AbortController().signal)).toBe(false);
  });
  it('rejects transport errors and does not start an already cancelled mutation', async () => {
    const error = { message: 'Unavailable' }; query(null, error);
    await expect(persistArenaEnrichment(deck, { bracket: '3' }, new AbortController().signal)).rejects.toBe(error);
    from.mockClear(); const controller = new AbortController(); controller.abort();
    await expect(persistArenaEnrichment(deck, { bracket: '3' }, controller.signal)).rejects.toThrow(); expect(from).not.toHaveBeenCalled();
  });
  it('deduplicates color targets and does not resolve already known colors', () => {
    expect(buildArenaColorTargets(['deck', 'deck', '', 'missing'], [deck], {}, [])).toEqual([deck]);
    expect(buildArenaColorTargets(['deck'], [deck], { deck: ['U'] }, [])).toEqual([]);
  });
});
