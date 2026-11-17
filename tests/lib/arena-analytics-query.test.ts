import {describe,expect,it,vi} from 'vitest';
import {fetchArenaAnalyticsReport} from '@/packages/data/arena-analytics-query';
const complete={totalMatches:1234,players:[],commanders:[],colors:[],decks:[]};
function client(data:unknown,error:unknown=null) {return {rpc:vi.fn(()=>({abortSignal:async()=>({data,error})}))};}
describe('arena aggregate transport',()=>{
  it('uses complete server counts independently of visible match pages',async()=>{
    const api=client(complete);
    expect(await fetchArenaAnalyticsReport(api,'group',null)).toEqual(complete);
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith('get_arena_analytics_bundle',{p_group_id:'group',p_since:null,p_until:null});
  });
  it.each([null,[],{}, {...complete,totalMatches:-1},{...complete,totalMatches:1.5},{...complete,players:[null]},{...complete,decks:undefined}])('rejects incomplete successful payloads',async(value)=>{
    await expect(fetchArenaAnalyticsReport(client(value),'group',null)).rejects.toThrow('ARENA_ANALYTICS_CONTRACT_INVALID');
  });
  it('sanitizes backend failures without returning successful zeroes',async()=>{
    await expect(fetchArenaAnalyticsReport(client(null,{message:'private detail'}),'group',null)).rejects.toThrow('ARENA_ANALYTICS_UNAVAILABLE');
  });
  it('cancels a request belonging to an old account',async()=>{
    const controller=new AbortController();controller.abort();
    await expect(fetchArenaAnalyticsReport(client(complete),'group',null,controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
});
