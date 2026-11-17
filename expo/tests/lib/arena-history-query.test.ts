import {describe,expect,it,vi} from 'vitest';
import {fetchArenaHistoryDaySummaries,fetchArenaHistoryPage} from '@/lib/arena-history-query';
import {arenaHistoryScope} from '../../../packages/domain/arena-history';
import {historyDaysFixture,historyGroup,historyId,historyPageFixture} from '../../../tests/fixtures/arena-history';
describe('native shared history transport',()=>{
  it('uses scoped complete pages, including unknown chronology, without a raw query fallback',async()=>{
    const rpc=vi.fn(()=>({abortSignal:async()=>({data:historyPageFixture(),error:null})}));
    const page=await fetchArenaHistoryPage({rpc},arenaHistoryScope(historyGroup));
    expect(page.total).toBe(4);expect(page.matches.at(-1)?.arena_day_key).toBe('undated');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_arena_history_page_v2',expect.objectContaining({p_group_id:historyGroup,p_limit:100}));
    await expect(fetchArenaHistoryPage({rpc},arenaHistoryScope(historyId(999)))).rejects.toThrow('ARENA_HISTORY_CONTRACT_INVALID');
  });
  it('requires complete day summaries and exposes revision invalidation',async()=>{
    const rpc=vi.fn().mockReturnValueOnce({abortSignal:async()=>({data:historyDaysFixture(),error:null})})
      .mockReturnValueOnce({abortSignal:async()=>({data:null,error:{code:'40001'}})})
      .mockReturnValueOnce({abortSignal:async()=>({data:[],error:null})});
    expect((await fetchArenaHistoryDaySummaries({rpc},historyGroup)).totalDays).toBe(3);
    await expect(fetchArenaHistoryPage({rpc},arenaHistoryScope(historyGroup))).rejects.toThrow('ARENA_HISTORY_CHANGED');
    await expect(fetchArenaHistoryDaySummaries({rpc},historyGroup)).rejects.toThrow('ARENA_HISTORY_CONTRACT_INVALID');
  });
});
