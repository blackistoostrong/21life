import {beforeEach,describe,expect,it,vi} from 'vitest';
const hooks=vi.hoisted(()=>({values:[] as unknown[],cursor:0,effects:[] as Array<()=>void>}));
vi.mock('react',async original=>{
  const memo=(compute:()=>unknown,deps:unknown[])=>{
    const i=hooks.cursor++,previous=hooks.values[i] as {deps:unknown[];value:unknown}|undefined;
    if(!previous || deps.some((value,index)=>!Object.is(value,previous.deps[index])))hooks.values[i]={deps,value:compute()};
    return (hooks.values[i] as {value:unknown}).value;
  };
  return {...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=initial;
    return [hooks.values[i],(next:unknown)=>{hooks.values[i]=typeof next==='function'?next(hooks.values[i]):next;}];},
  useRef:(initial:unknown)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]={current:initial};return hooks.values[i];},
  useMemo:memo,useCallback:(fn:unknown,deps:unknown[])=>memo(()=>fn,deps),
  useEffect:(setup:()=>void|(()=>void),deps:unknown[])=>{
    const i=hooks.cursor++,previous=hooks.values[i] as {deps:unknown[];cleanup?:()=>void}|undefined;
    if(!previous || deps.some((value,index)=>!Object.is(value,previous.deps[index])))hooks.effects.push(()=>{
      previous?.cleanup?.();hooks.values[i]={deps,cleanup:setup()};
    });
  },
};});
vi.mock('@/lib/supabase',()=>({supabase:{}}));
vi.mock('@/lib/arena-history-query',()=>({fetchArenaHistoryPage:vi.fn(),fetchCompleteArenaHistoryDay:vi.fn()}));
import {useArenaHistory} from '@/hooks/use-arena-history';
import {fetchArenaHistoryPage,fetchCompleteArenaHistoryDay} from '@/lib/arena-history-query';
import {useArenaDayExport} from '@/hooks/use-arena-day-export';
import {historyGroup,historyId,historyPageFixture} from '../../../tests/fixtures/arena-history';
import {arenaHistoryScope,parseArenaHistoryPage} from '../../../packages/domain/arena-history';
const rpc=vi.mocked(fetchArenaHistoryPage);
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function render(group:string|undefined=historyGroup,user:string|undefined=historyId(900),flush=true){
  hooks.cursor=0;hooks.effects=[];const result=useArenaHistory(group,user);
  if(flush)hooks.effects.splice(0).forEach(effect=>effect());return result;
}
const page=()=>parseArenaHistoryPage(historyPageFixture(),arenaHistoryScope(historyGroup));
beforeEach(()=>{hooks.values=[];hooks.cursor=0;hooks.effects=[];rpc.mockReset();});
describe('native history ownership',()=>{
  it('labels cached rows without deriving a total or a continuation cursor',async()=>{
    render().seed(page().matches as never);
    expect(render()).toMatchObject({cached:true,total:null,hasMore:false});
    rpc.mockRejectedValueOnce(new Error('ARENA_HISTORY_UNAVAILABLE'));
    await render().reload();
    expect(render()).toMatchObject({cached:true,total:null,error:'ARENA_HISTORY_UNAVAILABLE'});
    expect(render().matches).toHaveLength(4);
    rpc.mockResolvedValueOnce(page());await render().reload();
    expect(render()).toMatchObject({cached:false,total:4,error:null,hasMore:false});
  });
  it('does not turn a first-page backend failure into confirmed empty history',async()=>{
    rpc.mockRejectedValueOnce(new Error('ARENA_HISTORY_FORBIDDEN'));
    await render().reload();expect(render()).toMatchObject({total:null,error:'ARENA_HISTORY_FORBIDDEN'});
  });
  it('masks previous account data before effects and ignores late results after switching groups',async()=>{
    const pending=deferred<ReturnType<typeof page>>();rpc.mockReturnValueOnce(pending.promise);
    const old=render();const read=old.reload();const oldSignal=rpc.mock.calls[0][4]!;
    expect(render(historyId(800),historyId(901),false).matches).toEqual([]);
    render(historyId(800),historyId(901));expect(oldSignal.aborted).toBe(true);
    await old.reload();expect(rpc).toHaveBeenCalledOnce();
    pending.resolve(page());await read;
    expect(render(historyId(800),historyId(901)).matches).toEqual([]);
  });
  it('aborts superseded refreshes without publishing their results',async()=>{
    const slow=deferred<ReturnType<typeof page>>();rpc.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page());
    const read=render().reload();const signal=rpc.mock.calls[0][4]!;
    await render().reload();expect(signal.aborted).toBe(true);slow.resolve({...page(),total:999});await read;
    expect(render().total).toBe(4);
  });
});

it('appends a revision-bound next page once and preserves explicit failure state',async()=>{
  const first={...page(),total:101,matches:Array.from({length:100},(_,index)=>({...page().matches[0],id:historyId(201-index)})),next:{id:historyId(102),playedAt:page().matches[0].played_at}};
  rpc.mockResolvedValueOnce(first);
  await render().reload();
  const next=deferred<ReturnType<typeof page>>();rpc.mockReturnValueOnce(next.promise);
  const one=render().loadMore();await render().loadMore();expect(rpc).toHaveBeenCalledTimes(2);
  next.resolve({...page(),total:101,matches:[{...page().matches[0],id:historyId(101)}],next:null});await one;
  expect(render()).toMatchObject({total:101,hasMore:false});expect(render().matches).toHaveLength(101);
  rpc.mockRejectedValueOnce(new Error('ARENA_HISTORY_CHANGED'));await render().reload();
  expect(render()).toMatchObject({total:101,error:'ARENA_HISTORY_CHANGED'});
});

it('never publishes an old export after closing or changing its owner',async()=>{
  const api=vi.mocked(fetchCompleteArenaHistoryDay);api.mockReset();
  const old=deferred<ReturnType<typeof page>['matches']>();const next=deferred<ReturnType<typeof page>['matches']>();
  api.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const scope=arenaHistoryScope(historyGroup);
  const exportView=(user:string|undefined,day:string|null)=>{
    hooks.cursor=0;hooks.effects=[];const result=useArenaDayExport(user,scope,day);
    hooks.effects.splice(0).forEach(effect=>effect());return result;
  };
  exportView('old-user','2010-01-01');const signal=api.mock.calls[0][3]!;
  exportView('new-user','2010-01-01');expect(signal.aborted).toBe(true);
  old.resolve(page().matches);await Promise.resolve();expect(exportView('new-user','2010-01-01').ready).toBe(false);
  next.resolve(page().matches);await Promise.resolve();expect(exportView('new-user','2010-01-01').matches).toHaveLength(4);
  expect(exportView('new-user',null).matches).toEqual([]);
});
