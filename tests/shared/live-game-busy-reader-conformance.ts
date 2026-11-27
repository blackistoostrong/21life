import {expect,it} from 'vitest';
type Reader=(keys:string[],options?:{excludeLiveGameId?:string;signal?:AbortSignal})=>Promise<string[]>;
export function liveGameBusyReaderConformance(factory:(fetcher:typeof fetch)=>Reader){
 for(const rematch of [false,true])it(`busy reader ${rematch?'excludes only the previous round':'retains normal start filters'}`,async()=>{
  const calls:URL[]=[];
  const reader=factory(async(input)=>{calls.push(new URL(input instanceof Request?input.url:String(input)));return Response.json([{participant_key:'guest:busy'}]);});
  expect(await reader(['user:a','guest:busy'],rematch?{excludeLiveGameId:'previous'}:undefined)).toEqual(['guest:busy']);
  expect(calls).toHaveLength(1);const query=calls[0].searchParams;
  expect(query.get('group_id')).toBe('eq.group');expect(query.get('status')).toBe('eq.active');
  expect(query.get('is_eliminated')).toBe('eq.false');expect(query.get('participant_key')).toBe('in.(user:a,guest:busy)');
  expect(query.get('live_game_id')).toBe(rematch?'neq.previous':null);
 });
 it('empty participants do not query the backend',async()=>{
  let count=0;const reader=factory(async()=>{count++;return Response.json([]);});
  expect(await reader([],{excludeLiveGameId:'previous'})).toEqual([]);expect(count).toBe(0);
 });
 it('busy lookup forwards cancellation to the real SDK transport',async()=>{
  const controller=new AbortController();let received=false;
  const reader=factory(async(_input,init)=>new Promise<Response>((_resolve,reject)=>{
   const abort=()=>{received=true;reject(new DOMException('Aborted','AbortError'));};
   if(init?.signal?.aborted)abort();else init?.signal?.addEventListener('abort',abort,{once:true});
  }));
  const pending=reader(['user:a'],{excludeLiveGameId:'previous',signal:controller.signal});
  controller.abort();await expect(pending).rejects.toBeDefined();expect(received).toBe(true);
 });
}
