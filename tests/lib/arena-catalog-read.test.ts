import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchArenaMemberDecks } from '@/lib/arena-catalog-read';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from } }));
const signal = () => new AbortController().signal;

describe('arena member catalog transport', () => {
  beforeEach(() => { rpc.mockReset(); from.mockReset(); });
  it('does not start work after cancellation or with no members', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(fetchArenaMemberDecks('group', ['member'], controller.signal)).rejects.toThrow();
    expect(await fetchArenaMemberDecks('group', [], signal())).toEqual([]);
    expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });
  it('returns the bounded RPC catalog without legacy queries', async () => {
    const decks = [{ id: 'deck' }];
    rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: decks, error: null }) });
    expect(await fetchArenaMemberDecks('group', ['member'], signal())).toEqual(decks);
    expect(rpc).toHaveBeenCalledWith('get_arena_member_decks', { p_group_id: 'group', p_user_ids: ['member'], p_limit_per_user: 120 });
    expect(from).not.toHaveBeenCalled();
  });
  it.each(['42501', 'XX000', ''])('does not reinterpret RPC failure %s as an empty or compatibility catalog', async code => {
    const error = { code, message: 'Unavailable' };
    rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error }) });
    await expect(fetchArenaMemberDecks('group', ['member'], signal())).rejects.toBe(error);
    expect(from).not.toHaveBeenCalled();
  });
  it('preserves legacy per-member filters only for a missing RPC', async () => {
    rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } }) });
    const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), or: vi.fn(), order: vi.fn(), limit: vi.fn(), abortSignal: vi.fn() };
    Object.values(query).forEach(fn => fn.mockReturnValue(query));
    query.abortSignal.mockResolvedValue({ data: [{ id: 'legacy' }], error: null });
    from.mockReturnValue(query);
    expect(await fetchArenaMemberDecks('group', ['member'], signal())).toEqual([{ id: 'legacy' }]);
    expect(query.eq).toHaveBeenCalledWith('user_id', 'member');
    expect(query.is).toHaveBeenCalledWith('group_id', null);
    expect(query.or).toHaveBeenCalledWith('source_type.is.null,source_type.neq.occasional');
    expect(query.limit).toHaveBeenCalledWith(120);
  });
  it('rejects partial fallback data and aborts sibling work', async () => {
    rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42883' } }) });
    const signals: AbortSignal[] = [];
    const error = { message: 'One member failed' };
    let count = 0;
    from.mockImplementation(() => {
      const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), or: vi.fn(), order: vi.fn(), limit: vi.fn(), abortSignal: vi.fn() };
      Object.values(query).forEach(fn => fn.mockReturnValue(query));
      query.abortSignal.mockImplementation((requestSignal: AbortSignal) => {
        signals.push(requestSignal);
        return ++count === 1 ? Promise.resolve({ data: null, error }) : new Promise(resolve => {
          requestSignal.addEventListener('abort', () => resolve({ data: null, error: { message: 'Cancelled' } }), { once: true });
        });
      });
      return query;
    });
    await expect(fetchArenaMemberDecks('group', ['a', 'b', 'c', 'd', 'e'], signal())).rejects.toBe(error);
    expect(from).toHaveBeenCalledTimes(4);
    expect(signals).toHaveLength(4);
    expect(signals.every(requestSignal => requestSignal.aborted)).toBe(true);
  });
});
