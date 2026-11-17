import {expect,it,vi} from 'vitest';
import {fetchArenaAnalyticsV2} from '../../packages/data/arena-analytics-query';
import {arenaAnalyticsScope} from '../../packages/domain/arena-analytics';
import {arenaGroup,arenaReportFixture} from '../fixtures/arena-analytics';
it('binds the complete RPC to group, period and bracket without a table fallback',async()=>{
 const rpc=vi.fn(()=>({abortSignal:async()=>({data:arenaReportFixture(),error:null})}));
 expect((await fetchArenaAnalyticsV2({rpc},arenaAnalyticsScope(arenaGroup))).totalMatches).toBe(3);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('get_arena_analytics_bundle_v2',{p_group_id:arenaGroup,p_since:null,p_until:null,p_bracket:null});
});
it('rejects incompatible success and sanitizes database failure',async()=>{
 const rpc=vi.fn().mockReturnValueOnce({abortSignal:async()=>({data:{},error:null})}).mockReturnValueOnce({abortSignal:async()=>({data:null,error:{message:'private SQL'}})});
 await expect(fetchArenaAnalyticsV2({rpc},arenaAnalyticsScope(arenaGroup))).rejects.toThrow('ARENA_ANALYTICS_CONTRACT_INVALID');
 await expect(fetchArenaAnalyticsV2({rpc},arenaAnalyticsScope(arenaGroup))).rejects.toThrow('ARENA_ANALYTICS_UNAVAILABLE');
});
it('never starts transport for an obsolete account request',async()=>{
 const controller=new AbortController();controller.abort();const abortSignal=vi.fn();
 await expect(fetchArenaAnalyticsV2({rpc:()=>({abortSignal})},arenaAnalyticsScope(arenaGroup),controller.signal)).rejects.toMatchObject({name:'AbortError'});
 expect(abortSignal).not.toHaveBeenCalled();
});
