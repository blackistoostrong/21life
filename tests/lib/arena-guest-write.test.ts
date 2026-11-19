import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteArenaGuest, saveArenaGuestDeck, type GuestDeckDraft } from '@/lib/arena-guest-write';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
type Result = { data: unknown; error: unknown };
const guest = { id: 'guest', group_id: 'group', display_name: 'Alice', last_played_at: null };
const deck = { id: 'deck', guest_id: 'guest', group_id: 'group', name: 'Talrand', commander: 'Talrand',
  commander_image: null, color_identity: ['U'], bracket: null };
const draft: GuestDeckDraft = { groupId: 'group', name: ' Alice ', deckName: '', guestId: null, partner: null,
  commander: { id: 'talrand', name: 'Talrand', imageUrl: null, typeLine: 'Legendary Creature', colorIdentity: ['U'], oracleText: '', keywords: [] } };
const signal = () => new AbortController().signal;
function query(data: unknown, error: unknown = null, result?: () => Result | Promise<Result>) {
  const methods = { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn(), abortSignal: vi.fn() };
  const q = { ...methods, then: (fulfilled: (result: Result) => unknown, rejected?: (error: unknown) => unknown) =>
    Promise.resolve().then(() => result ? result() : { data, error }).then(fulfilled, rejected) };
  Object.values(methods).forEach(method => method.mockReturnValue(q));
  from.mockReturnValueOnce(q); return q;
}

describe('arena guest write transport', () => {
  beforeEach(() => from.mockReset());
  it('reuses a normalized name only within this group and preserves deck defaults', async () => {
    const insert = query(deck); const touch = query(null);
    expect(await saveArenaGuestDeck(draft, [{ ...guest, display_name: 'alice' }], signal())).toEqual(deck);
    expect(from.mock.calls.map(call => call[0])).toEqual(['arena_guest_decks', 'arena_guests']);
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Talrand', guest_id: 'guest', group_id: 'group', color_identity: ['U'] }));
    expect(touch.eq).toHaveBeenCalledWith('group_id', 'group');
  });
  it('creates a guest before the deck and does not reuse another group guest', async () => {
    const insert = query(guest); query(deck); query(null);
    expect(await saveArenaGuestDeck({ ...draft, deckName: ' Custom ' }, [{ ...guest, group_id: 'other' }], signal())).toEqual(deck);
    expect(insert.insert).toHaveBeenCalledWith({ group_id: 'group', display_name: 'Alice', normalized_name: 'alice' });
  });
  it('recovers a unique conflict after partial guest creation using both scope filters', async () => {
    query(null, { code: '23505' }); const recovered = query(guest); query(deck); query(null);
    expect(await saveArenaGuestDeck(draft, [], signal())).toEqual(deck);
    expect(recovered.eq).toHaveBeenCalledWith('group_id', 'group');
    expect(recovered.eq).toHaveBeenCalledWith('normalized_name', 'alice');
  });
  it('does not reinterpret other guest errors as a recoverable duplicate', async () => {
    const error = { code: '42501' }; query(null, error);
    await expect(saveArenaGuestDeck(draft, [], signal())).rejects.toBe(error);
    expect(from).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ...guest, group_id: 'other' }])('rejects an invalid guest acknowledgement %j', async data => {
    query(data);
    await expect(saveArenaGuestDeck(draft, [], signal())).rejects.toThrow('Guest was not acknowledged');
    expect(from).toHaveBeenCalledTimes(1);
  });
  it('rejects blank names before creating any row', async () => {
    await expect(saveArenaGuestDeck({ ...draft, name: '  ' }, [], signal())).rejects.toThrow('Guest name is required');
    expect(from).not.toHaveBeenCalled();
  });
  it('does not touch a guest after a failed or mismatched deck acknowledgement', async () => {
    const error = { message: 'Deck rejected' }; query(null, error);
    await expect(saveArenaGuestDeck({ ...draft, guestId: 'guest' }, [], signal())).rejects.toBe(error);
    query({ ...deck, guest_id: 'other' });
    await expect(saveArenaGuestDeck({ ...draft, guestId: 'guest' }, [], signal())).rejects.toThrow('Guest deck was not acknowledged');
    expect(from).toHaveBeenCalledTimes(2);
  });
  it('does not turn a failed ancillary timestamp into a duplicate deck retry', async () => {
    query(deck); query(null, null, () => Promise.reject(new Error('Timestamp unavailable')));
    expect(await saveArenaGuestDeck({ ...draft, guestId: 'guest' }, [], signal())).toEqual(deck);
  });
  it('stops before I/O when cancelled and before the next step after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(saveArenaGuestDeck(draft, [], controller.signal)).rejects.toThrow();
    await expect(deleteArenaGuest('group', 'guest', controller.signal)).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
    const next = new AbortController(); query(guest, null, () => { next.abort(); return { data: guest, error: null }; });
    await expect(saveArenaGuestDeck(draft, [], next.signal)).rejects.toThrow();
    expect(from).toHaveBeenCalledTimes(1);
  });
  it('requires the identified deleted row and propagates deletion errors', async () => {
    const deleted = query([{ id: 'guest' }]);
    await deleteArenaGuest('group', 'guest', signal());
    expect(deleted.eq).toHaveBeenCalledWith('id', 'guest'); expect(deleted.eq).toHaveBeenCalledWith('group_id', 'group');
    query([]); await expect(deleteArenaGuest('group', 'guest', signal())).rejects.toThrow('Guest was not deleted');
    const error = { message: 'Delete rejected' }; query(null, error);
    await expect(deleteArenaGuest('group', 'guest', signal())).rejects.toBe(error);
  });
  it('aborts the underlying SDK request at its deadline', async () => {
    vi.useFakeTimers();
    try {
      const pending = query(null, null, () => new Promise<Result>(() => {}));
      const result = expect(saveArenaGuestDeck(draft, [], signal())).rejects.toThrow('Operation timed out');
      await vi.advanceTimersByTimeAsync(15000); await result;
      expect(pending.abortSignal.mock.calls[0][0].aborted).toBe(true);
      expect(from).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
