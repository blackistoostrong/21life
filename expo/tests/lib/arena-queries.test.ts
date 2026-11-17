import { describe, expect, it, vi } from 'vitest';
import { fetchArenaMemberDecks } from '@/lib/arena-queries';

describe('arena queries', () => {
  it('reports catalog errors to a strict refresh instead of returning an empty successful list', async () => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'or', 'order']) chain[method] = () => chain;
    chain.limit = async () => ({ data: null, error: { message: 'private database details' } });
    const client = { rpc: vi.fn().mockResolvedValue({ error: { message: 'rpc unavailable' } }), from: vi.fn().mockReturnValue(chain) };
    await expect(fetchArenaMemberDecks(client as never, 'group', ['user'], { strict: true })).rejects.toThrow('ARENA_DECKS_READ_FAILED');
  });
  it('does not treat a missing RPC payload as a confirmed empty catalog', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    await expect(fetchArenaMemberDecks(client as never, 'group', ['user'], { strict: true })).rejects.toThrow('ARENA_DECKS_READ_FAILED');
  });
  it('fetches every member deck list with one bounded RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'deck-1', user_id: 'user-1' }],
      error: null,
    });
    const from = vi.fn();
    const result = await fetchArenaMemberDecks({ rpc, from } as never, 'group-1', [
      'user-1',
      'user-2',
    ]);

    expect(result).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('get_arena_member_decks', {
      p_group_id: 'group-1',
      p_user_ids: ['user-1', 'user-2'],
      p_limit_per_user: 120,
    });
    expect(from).not.toHaveBeenCalled();
  });
});
