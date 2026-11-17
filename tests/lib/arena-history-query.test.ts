import {afterEach,describe,expect,it,vi} from 'vitest';
import {fetchArenaHistoryDaySummaries,fetchArenaHistoryPage} from '@/lib/arena-history-query';
import {arenaHistoryScope} from '@/packages/domain/arena-history';
import {historyDaysFixture,historyGroup,historyPageFixture,historyRevision} from '../fixtures/arena-history';

describe('scoped history transport',()=>{
  afterEach(()=>vi.useRealTimers());
  it('requests only the versioned complete-page endpoint and binds filters to the response',async()=>{
    const rpc=vi.fn(()=>({abortSignal:async()=>({data:historyPageFixture(),error:null})}));
    expect((await fetchArenaHistoryPage({rpc},arenaHistoryScope(historyGroup))).total).toBe(4);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_arena_history_page_v2',{
      p_group_id:historyGroup,p_limit:100,p_before_time:null,p_before_id:null,p_revision:null,p_since:null,p_until:null,p_day_key:null,p_boundary_hour:8,
    });
  });
  it('continues exactly after the acknowledged cursor under the same revision',async()=>{
    const first=historyPageFixture();
    const scope=arenaHistoryScope(historyGroup,{limit:2});
    const cursor={id:first.matches[1].id,playedAt:first.matches[1].played_at};
    const response={...first,matches:first.matches.slice(2)};
    const rpc=vi.fn(()=>({abortSignal:async()=>({data:response,error:null})}));
    expect((await fetchArenaHistoryPage({rpc},scope,cursor,historyRevision)).matches).toHaveLength(2);
    expect(rpc.mock.calls[0]).toEqual(['get_arena_history_page_v2',expect.objectContaining({p_before_id:cursor.id,p_before_time:cursor.playedAt,p_revision:historyRevision})]);
    await expect(fetchArenaHistoryPage({rpc},scope,cursor)).rejects.toThrow('ARENA_HISTORY_CONTRACT_INVALID');
    await expect(fetchArenaHistoryPage({rpc},scope,null,'bad')).rejects.toThrow('ARENA_HISTORY_CONTRACT_INVALID');
    expect(rpc).toHaveBeenCalledOnce();
  });
  it.each([['40001','ARENA_HISTORY_CHANGED'],['42501','ARENA_HISTORY_FORBIDDEN'],['42883','ARENA_HISTORY_UNAVAILABLE']])('reports %s without a raw-table fallback',async(code,message)=>{
    const rpc=vi.fn(()=>({abortSignal:async()=>({data:null,error:{code,message:'private SQL detail'}})}));
    await expect(fetchArenaHistoryPage({rpc},arenaHistoryScope(historyGroup))).rejects.toThrow(message);
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('refuses missing successful payloads and excessive response bytes',async()=>{
    const rpc=vi.fn().mockReturnValueOnce({abortSignal:async()=>({data:null,error:null})})
      .mockReturnValueOnce({abortSignal:async()=>({data:{large:'x'.repeat(4*1024*1024)},error:null})});
    await expect(fetchArenaHistoryPage({rpc},arenaHistoryScope(historyGroup))).rejects.toThrow('ARENA_HISTORY_CONTRACT_INVALID');
    await expect(fetchArenaHistoryPage({rpc},arenaHistoryScope(historyGroup))).rejects.toThrow('ARENA_HISTORY_TOO_LARGE');
  });
  it('cancels stalled requests and clears owned listeners/timers before retry',async()=>{
    vi.useFakeTimers();let transport:AbortSignal|undefined;
    const rpc=vi.fn(()=>({abortSignal:(signal:AbortSignal)=>{transport=signal;return new Promise<never>(()=>{});}}));
    const pending=expect(fetchArenaHistoryPage({rpc},arenaHistoryScope(historyGroup))).rejects.toThrow('ARENA_HISTORY_TIMEOUT');
    await vi.advanceTimersByTimeAsync(15000);await pending;
    expect(transport?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
    const controller=new AbortController();
    const remove=vi.spyOn(controller.signal,'removeEventListener');
    const second=expect(fetchArenaHistoryPage({rpc},arenaHistoryScope(historyGroup),null,null,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    controller.abort();await second;expect(remove).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it('does not start a transport for an already-aborted account context',async()=>{
    const controller=new AbortController();controller.abort();const abortSignal=vi.fn();
    await expect(fetchArenaHistoryPage({rpc:()=>({abortSignal})},arenaHistoryScope(historyGroup),null,null,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(abortSignal).not.toHaveBeenCalled();
  });
  it('uses complete versioned summaries and propagates summary failures',async()=>{
    const rpc=vi.fn().mockReturnValueOnce({abortSignal:async()=>({data:historyDaysFixture(),error:null})})
      .mockReturnValueOnce({abortSignal:async()=>({data:null,error:{code:'42501'}})});
    expect((await fetchArenaHistoryDaySummaries({rpc},historyGroup)).totalDays).toBe(3);
    await expect(fetchArenaHistoryDaySummaries({rpc},historyGroup)).rejects.toThrow('ARENA_HISTORY_FORBIDDEN');
    expect(rpc).toHaveBeenCalledWith('get_arena_match_day_summaries_v2',{p_group_id:historyGroup,p_boundary_hour:8});
  });
});
