import { describe, expect, it, vi } from 'vitest';
import { deleteArenaMatch } from '../../packages/data/arena-match-delete';
import { deleteArenaMatch as webDelete } from '../../lib/arena-match-write';
import { deleteArenaMatch as nativeDelete } from '../../expo/lib/arena-match-write';

describe('shared atomic arena match deletion', () => {
  it('deletes exactly the scoped parent and requires its acknowledged identity', async () => {
    const remove = vi.fn().mockResolvedValue({ data: [{ id: 'match' }], error: null });
    await deleteArenaMatch({ remove }, 'group', 'match', new AbortController().signal);
    expect(remove).toHaveBeenCalledExactlyOnceWith('group', 'match', expect.any(AbortSignal));
  });
  it.each([null, {}, [], [null], ['match'], [{}], [{ id: 'other' }]])('rejects incomplete acknowledgement %j', async data => {
    await expect(deleteArenaMatch({ remove: vi.fn().mockResolvedValue({ data, error: null }) }, 'group', 'match')).rejects.toThrow('Match was not deleted');
  });
  it('does not execute without context, after cancellation or after a server refusal', async () => {
    const error = { message: 'Denied', code: '42501' };
    const remove = vi.fn().mockResolvedValue({ data: null, error });
    await expect(deleteArenaMatch({ remove }, '', 'match')).rejects.toThrow('Missing arena match context');
    await expect(deleteArenaMatch({ remove }, 'group', '')).rejects.toThrow('Missing arena match context');
    const controller = new AbortController(); controller.abort();
    await expect(deleteArenaMatch({ remove }, 'group', 'match', controller.signal)).rejects.toThrow('Operation aborted');
    expect(remove).not.toHaveBeenCalled();
    await expect(deleteArenaMatch({ remove }, 'group', 'match')).rejects.toBe(error);
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('cancels the SDK wait when its private owner aborts', async () => {
    const controller = new AbortController(); let transportSignal!: AbortSignal;
    const remove = vi.fn((_group: string, _match: string, signal: AbortSignal) => {
      transportSignal = signal; return new Promise<{ data: unknown; error: unknown }>(() => {});
    });
    const result = expect(deleteArenaMatch({ remove }, 'group', 'match', controller.signal)).rejects.toThrow('Operation aborted');
    controller.abort(); await result; expect(transportSignal.aborted).toBe(true);
  });
  it('aborts the SDK request at the bounded deadline', async () => {
    vi.useFakeTimers();
    try {
      let signal!: AbortSignal;
      const remove = vi.fn((_group: string, _match: string, transport: AbortSignal) => {
        signal = transport; return new Promise<{ data: unknown; error: unknown }>(() => {});
      });
      const result = expect(deleteArenaMatch({ remove }, 'group', 'match')).rejects.toThrow('Operation timed out');
      await vi.advanceTimersByTimeAsync(15000); await result; expect(signal.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  const adapters = [
    ['web', (client: unknown) => webDelete(client as Parameters<typeof webDelete>[0], 'group', 'match')],
    ['native', (client: unknown) => nativeDelete(client as Parameters<typeof nativeDelete>[0], 'group', 'match')],
  ] as const;
  for (const [platform, remove] of adapters) {
    it(`${platform} adapter issues only DELETE matches with both filters and no participant mutation`, async () => {
      const query = { delete: vi.fn(), eq: vi.fn(), select: vi.fn(), abortSignal: vi.fn() };
      Object.values(query).forEach(method => method.mockReturnValue(query));
      query.abortSignal.mockResolvedValue({ data: [{ id: 'match' }], error: null });
      const from = vi.fn().mockReturnValue(query);
      await remove({ from });
      expect(from).toHaveBeenCalledExactlyOnceWith('matches');
      expect(query.delete).toHaveBeenCalledOnce(); expect(query.eq.mock.calls).toEqual([['id', 'match'], ['group_id', 'group']]);
      expect(query.select).toHaveBeenCalledExactlyOnceWith('id');
    });
  }
});
