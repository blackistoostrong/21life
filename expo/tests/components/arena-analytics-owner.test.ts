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
vi.mock('../../../packages/data/arena-analytics-query',()=>({fetchArenaAnalyticsV2:vi.fn()}));
import {useArenaAnalytics} from '@/hooks/use-arena-analytics';
import {fetchArenaAnalyticsV2} from '../../../packages/data/arena-analytics-query';
import {arenaGroup,arenaId,arenaReportFixture} from '../../../tests/fixtures/arena-analytics';
const rpc=vi.mocked(fetchArenaAnalyticsV2);
function RenderAnalytics(user=arenaId(1),group=arenaGroup,bracket='all',revision:string|null=null,flush=true){
 hooks.cursor=0;hooks.effects=[];const result=useArenaAnalytics(user,group,null,null,bracket,revision);
 if(flush)hooks.effects.splice(0).forEach(effect=>effect());return result;
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
beforeEach(()=>{hooks.values=[];hooks.cursor=0;hooks.effects=[];rpc.mockReset();});
describe('native complete analytics owner',()=>{
 it('requests filtered records and unfiltered awards as distinct complete scopes',async()=>{
  rpc.mockResolvedValue(arenaReportFixture());RenderAnalytics(arenaId(1),arenaGroup,'3');await settle();
  expect(rpc).toHaveBeenCalledTimes(2);expect(rpc.mock.calls[0][1].bracket).toBe('3');expect(rpc.mock.calls[1][1].bracket).toBeNull();
  expect(RenderAnalytics(arenaId(1),arenaGroup,'3').ready).toBe(true);
 });
 it('shows failure without successful empty counts or a history fallback',async()=>{
  rpc.mockRejectedValue(new Error('RPC unavailable'));RenderAnalytics();await settle();
  expect(RenderAnalytics()).toMatchObject({ready:false,error:true});expect(RenderAnalytics().current.totalMatches).toBeUndefined();
 });
 it('masks old accounts before effects and cancels obsolete requests',async()=>{
  let resolve!:(value:ReturnType<typeof arenaReportFixture>)=>void;
  rpc.mockReturnValueOnce(new Promise(done=>{resolve=done;}));RenderAnalytics();const signal=rpc.mock.calls[0][2]!;
  rpc.mockResolvedValue(arenaReportFixture());expect(RenderAnalytics(arenaId(2),arenaGroup,'all',null,false).ready).toBe(false);
  RenderAnalytics(arenaId(2));expect(signal.aborted).toBe(true);resolve(arenaReportFixture());await settle();
  expect(RenderAnalytics(arenaId(2)).ready).toBe(true);
 });
 it('refreshes complete aggregates when the authoritative history revision changes',async()=>{
  rpc.mockResolvedValue(arenaReportFixture());RenderAnalytics();await settle();
  RenderAnalytics(arenaId(1),arenaGroup,'all','revision-2');await settle();expect(rpc).toHaveBeenCalledTimes(2);
 });
});
