import {afterEach,describe,expect,it,vi} from 'vitest';
import {fetchArenaHistoryDaySummaries,fetchArenaHistoryPage,fetchCompleteArenaHistoryDay} from '@/lib/arena-history-query';
import {arenaHistoryScope} from '@/packages/domain/arena-history';
import {historyDaysFixture,historyGroup,historyPageFixture,historyRevision,historyMatch} from '../fixtures/arena-history';

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


describe('complete history day export',()=>{
  function transport(failSecond=false,total=251) {
    const matches=Array.from({length:total},(_,index)=>historyMatch(total-index,'2010-01-01T21:00:00Z','2010-01-01'));
    const rpc=vi.fn((_name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{
      const offset=args.p_before_id===null?0:matches.findIndex(row=>row.id===args.p_before_id)+1;
      if(failSecond && offset>0)return {data:null,error:{code:'40001'}};
      const page=matches.slice(offset,offset+Number(args.p_limit));const last=page.at(-1);
      return {data:{...historyPageFixture(),total,matches:page,filters:{since:null,until:null,dayKey:'2010-01-01',boundaryHour:8},
        next:offset+page.length<total?{id:last!.id,playedAt:last!.played_at}:null},error:null};
    }}));
    return {rpc,matches};
  }
  it('exports all 251 rows in three revision-bound pages',async()=>{
    const api=transport();
    const result=await fetchCompleteArenaHistoryDay(api,arenaHistoryScope(historyGroup),'2010-01-01');
    expect(result.map(row=>row.id)).toEqual(api.matches.map(row=>row.id));
    expect(api.rpc).toHaveBeenCalledTimes(3);
    expect(api.rpc.mock.calls[1][1].p_revision).toBe(historyRevision);
  });
  it('rejects the whole export when a later page changes',async()=>{
    const api=transport(true);
    await expect(fetchCompleteArenaHistoryDay(api,arenaHistoryScope(historyGroup),'2010-01-01')).rejects.toThrow('ARENA_HISTORY_CHANGED');
    expect(api.rpc).toHaveBeenCalledTimes(2);
  });
  it('rejects excessive days immediately and handles empty complete days',async()=>{
    const large=transport(false,5001);
    await expect(fetchCompleteArenaHistoryDay(large,arenaHistoryScope(historyGroup),'2010-01-01')).rejects.toThrow('ARENA_HISTORY_TOO_LARGE');
    expect(large.rpc).toHaveBeenCalledOnce();
    expect(await fetchCompleteArenaHistoryDay(transport(false,0),arenaHistoryScope(historyGroup),'2010-01-01')).toEqual([]);
  });
  it('aborts an obsolete account context',async()=>{
    const api=transport();const controller=new AbortController();controller.abort();
    await expect(fetchCompleteArenaHistoryDay(api,arenaHistoryScope(historyGroup),'2010-01-01',controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
});

it('bounds small-page traversals rather than holding an unbounded export',async()=>{
  const rpc=vi.fn((_name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{
    const id=Number(String(args.p_before_id??'100').slice(-3))-1;
    const match=historyMatch(id,'2010-01-01T21:00:00Z','2010-01-01');
    return {data:{...historyPageFixture(),total:100,matches:[match],filters:{since:null,until:null,dayKey:'2010-01-01',boundaryHour:8},next:{id:match.id,playedAt:match.played_at}},error:null};
  }}));
  await expect(fetchCompleteArenaHistoryDay({rpc},arenaHistoryScope(historyGroup,{limit:1}),'2010-01-01')).rejects.toThrow('ARENA_HISTORY_TOO_LARGE');
  expect(rpc).toHaveBeenCalledTimes(51);
});
it('rejects duplicate identities and inconsistent totals across export pages',async()=>{
  for(const failure of ['duplicate','total','short']) {
    let call=0;
    const rpc=()=>({abortSignal:async()=>{
      const first=++call===1;
      const match=historyMatch(first||failure==='duplicate'?5:4,first?'2010-01-01T21:00:00Z':'2010-01-01T20:00:00Z','2010-01-01');
      return {data:{...historyPageFixture(),total:failure==='total'&&!first?3:failure==='short'?3:2,matches:[match],filters:{since:null,until:null,dayKey:'2010-01-01',boundaryHour:8},next:first?{id:match.id,playedAt:match.played_at}:null},error:null};
    }});
    await expect(fetchCompleteArenaHistoryDay({rpc},arenaHistoryScope(historyGroup,{limit:1}),'2010-01-01')).rejects.toThrow('ARENA_HISTORY_CONTRACT_INVALID');
  }
});
it('bounds the whole export deadline even when individual pages keep progressing',async()=>{
  vi.useFakeTimers();
  try {
    let index=10;
    const rpc=()=>({abortSignal:async()=>{
      await new Promise(resolve=>setTimeout(resolve,11000));
      const match=historyMatch(index--,'2010-01-01T21:00:00Z','2010-01-01');
      return {data:{...historyPageFixture(),total:10,matches:[match],filters:{since:null,until:null,dayKey:'2010-01-01',boundaryHour:8},next:{id:match.id,playedAt:match.played_at}},error:null};
    }});
    const result=expect(fetchCompleteArenaHistoryDay({rpc},arenaHistoryScope(historyGroup,{limit:1}),'2010-01-01')).rejects.toMatchObject({name:'AbortError'});
    await vi.advanceTimersByTimeAsync(30000);await result;
    await vi.runAllTimersAsync();expect(vi.getTimerCount()).toBe(0);
  } finally {vi.useRealTimers();}
});
it('refuses oversized multi-page export payloads without exposing the partial result',async()=>{
  let index=10;
  const rpc=()=>({abortSignal:async()=>{
    const match=historyMatch(index--,'2010-01-01T21:00:00Z','2010-01-01');
    Reflect.set(match,'notes','x'.repeat(3*1024*1024));
    return {data:{...historyPageFixture(),total:10,matches:[match],filters:{since:null,until:null,dayKey:'2010-01-01',boundaryHour:8},next:{id:match.id,playedAt:match.played_at}},error:null};
  }});
  await expect(fetchCompleteArenaHistoryDay({rpc},arenaHistoryScope(historyGroup,{limit:1}),'2010-01-01')).rejects.toThrow('ARENA_HISTORY_TOO_LARGE');
});
