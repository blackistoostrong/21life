import {expect, it, vi} from 'vitest';
import {fetchCompleteArenaHistoryPeriod} from '@/lib/arena-history-query';
import {historyGroup, historyMatch, historyPageFixture, historyRevision} from '../fixtures/arena-history';

const period = {groupId: historyGroup, since: '2010-01-01T00:00:00Z', until: '2010-01-08T00:00:00Z'};
function transport(total = 101, failure?: 'revision' | 'filters') {
  let call = 0;
  return {rpc: vi.fn((_name: string, args: Record<string, unknown>) => ({abortSignal: async () => {
    call++;
    if (failure === 'revision' && call > 1) return {data: null, error: {code: '40001'}};
    const before = args.p_before_id ? Number(String(args.p_before_id).slice(-6)) : total + 1;
    const count = Math.min(100, before - 1);
    const matches = Array.from({length: count}, (_, offset) => historyMatch(before - offset - 1, '2010-01-02T06:00:00Z', '2010-01-02'));
    const last = matches.at(-1);
    return {data: {...historyPageFixture(), total, matches,
      filters: {since: period.since, until: period.until, dayKey: null, boundaryHour: failure === 'filters' ? 8 : 0},
      next: last && before - count > 1 ? {id: last.id, playedAt: last.played_at} : null}, error: null};
  }}))};
}
it('reads a complete period with calendar boundaries, current revision and no day truncation', async () => {
  const client = transport();
  const matches = await fetchCompleteArenaHistoryPeriod(client, period);
  expect(matches).toHaveLength(101); expect(new Set(matches.map(match => match.id)).size).toBe(101);
  expect(client.rpc).toHaveBeenCalledTimes(2);
  expect(client.rpc.mock.calls[0]).toEqual(['get_arena_history_page_v2', {
    p_group_id: historyGroup, p_limit: 100, p_before_time: null, p_before_id: null, p_revision: null,
    p_since: period.since, p_until: period.until, p_day_key: null, p_boundary_hour: 0,
  }]);
  expect(client.rpc.mock.calls[1][1]).toMatchObject({p_revision: historyRevision, p_before_id: matches[99].id});
});
it('returns an acknowledged empty period and rejects oversized periods without partial output', async () => {
  expect(await fetchCompleteArenaHistoryPeriod(transport(0), period)).toEqual([]);
  const client = transport(5001);
  await expect(fetchCompleteArenaHistoryPeriod(client, period)).rejects.toThrow('ARENA_HISTORY_TOO_LARGE');
  expect(client.rpc).toHaveBeenCalledOnce();
});
it.each(['revision', 'filters'] as const)('rejects %s changes instead of returning a partial recap source', async failure => {
  await expect(fetchCompleteArenaHistoryPeriod(transport(101, failure), period)).rejects.toThrow(
    failure === 'revision' ? 'ARENA_HISTORY_CHANGED' : 'ARENA_HISTORY_CONTRACT_INVALID');
});
it.each([
  {...period, since: null}, {...period, until: null}, {...period, until: '2010-02-02T00:00:00Z'},
])('refuses unbounded or excessive recap intervals before querying', async input => {
  const client = transport();
  await expect(fetchCompleteArenaHistoryPeriod(client, input)).rejects.toThrow('ARENA_HISTORY_PERIOD_INVALID');
  expect(client.rpc).not.toHaveBeenCalled();
});
it('aborts an obsolete period opening', async () => {
  const client = transport(), controller = new AbortController(); controller.abort();
  await expect(fetchCompleteArenaHistoryPeriod(client, period, controller.signal)).rejects.toMatchObject({name: 'AbortError'});
});
