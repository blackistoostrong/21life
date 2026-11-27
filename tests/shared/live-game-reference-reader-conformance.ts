import {afterEach,expect,it,vi} from 'vitest';
import {readLiveGameRoundReferences,type LiveGameReferenceReader} from '../../packages/data/live-game-round-references';
import {reconcileLiveGameReferences} from '../../packages/domain/live-game-reference-validation';

const seats=[{participantKey:'user:alice' as const,deckId:'deck-a'},{participantKey:'guest:bob' as const,deckId:'deck-b'}];
export function liveGameReferenceReaderConformance(createReader:(fetcher:typeof fetch)=>LiveGameReferenceReader){
afterEach(()=>vi.useRealTimers());
function fixture(){
 const data:Record<string,unknown>={
  groups:[{id:'group',group_members:[{user_id:'alice',profiles:{id:'alice',username:'alice',display_name:'Alice now'}}]}],
  decks:[{id:'deck-a',user_id:'alice',group_id:null,commander:'Current A',commander_image:null,is_archived:false,source_type:'manual'}],
  arena_guests:[{id:'bob',group_id:'group',display_name:'Bob now'}],
  arena_guest_decks:[{id:'deck-b',guest_id:'bob',group_id:'group',commander:'Current B',commander_image:'art'}],
 };
 const calls:{url:URL;signal:AbortSignal|null|undefined}[]=[];
 let failure:string|null=null;let pending:string|null=null;let groupDelay=0;
 const reader=createReader(async(input,init)=>{
   const url=new URL(input instanceof Request?input.url:String(input));const table=url.pathname.split('/').at(-1)!;
   calls.push({url,signal:init?.signal});
   if(table==='groups'&&groupDelay)await new Promise<void>(resolve=>setTimeout(resolve,groupDelay));
   if(table===pending)return new Promise<Response>((_resolve,reject)=>{
    const abort=()=>reject(new DOMException('Aborted','AbortError'));
    if(init?.signal?.aborted)abort();else init?.signal?.addEventListener('abort',abort,{once:true});
   });
   return table===failure?Response.json({message:'Unavailable'},{status:400}):Response.json(data[table]);
  });
 return{data,calls,read:(signal?:AbortSignal)=>readLiveGameRoundReferences(reader,{groupId:'group',actorId:'alice',seats},signal),
  fail:(table:string)=>{failure=table;},hold:(table:string)=>{pending=table;},delayGroup:(ms:number)=>{groupDelay=ms;},reader};
}
it('reads the requested references with the real SDK, without a catalog cap or fallback metadata',async()=>{
 const f=fixture();const result=await f.read();expect(result.kind).toBe('ready');
 if(result.kind!=='ready')throw Error('Expected ready');
 const plan=reconcileLiveGameReferences(seats,result.participants,{allowArchived:true});
 expect(plan.issues).toEqual([]);expect(plan.resolved.map(value=>value.commander)).toEqual(['Current A','Current B']);
 expect(f.calls.map(call=>call.url.pathname.split('/').at(-1))).toEqual(['groups','decks','arena_guests','arena_guest_decks']);
 expect(f.calls[0].url.searchParams.get('group_members.user_id')).toBe('in.(alice)');
 expect(f.calls[1].url.searchParams.get('id')).toBe('in.(deck-a)');
 expect(f.calls.every(call=>!call.url.searchParams.has('limit'))).toBe(true);
 expect(f.calls.every(call=>call.signal instanceof AbortSignal)).toBe(true);
});
it.each(['missing group','not a member'])('does not request private deck/guest data for %s',async kind=>{
 const f=fixture();f.data.groups=kind==='missing group'?[]:[{id:'group',group_members:[]}];
 expect(await f.read()).toEqual({kind:'denied'});expect(f.calls).toHaveLength(1);
});
it('returns an empty deck choice for a confirmed deletion without inventing a replacement',async()=>{
 const f=fixture();f.data.decks=[];const result=await f.read();if(result.kind!=='ready')throw Error('Expected ready');
 expect(reconcileLiveGameReferences(seats,result.participants,{allowArchived:true}).seats[0])
  .toEqual({participantKey:'user:alice',deckId:null});
});
it.each(['another owner','another group','historical'])('excludes a requested deck that belongs to %s',async kind=>{
 const f=fixture();const deck=(f.data.decks as Record<string,unknown>[])[0];
 if(kind==='another owner')deck.user_id='other';else if(kind==='another group')deck.group_id='other-group';else deck.source_type='historical';
 const result=await f.read();if(result.kind!=='ready')throw Error('Expected ready');
 expect(result.participants.find(value=>value.key==='user:alice')?.decks).toEqual([]);
});
it('retains archive metadata so callers can preserve arena policy or enforce preset eligibility',async()=>{
 const f=fixture();(f.data.decks as Record<string,unknown>[])[0].is_archived=true;
 const result=await f.read();if(result.kind!=='ready')throw Error('Expected ready');
 expect(reconcileLiveGameReferences(seats,result.participants,{allowArchived:true}).issues).toEqual([]);
 expect(reconcileLiveGameReferences(seats,result.participants,{allowArchived:false}).issues).toEqual([{seat:0,reason:'deck_archived'}]);
});
it('does not reject a legacy deck solely for empty optional artwork or commander text',async()=>{
 const f=fixture();const deck=(f.data.decks as Record<string,unknown>[])[0];deck.commander='';deck.commander_image='';
 const result=await f.read();if(result.kind!=='ready')throw Error('Expected ready');
 expect(result.participants.find(value=>value.key==='user:alice')?.decks[0]).toMatchObject({id:'deck-a',commander:'',commanderImage:null});
});
it('fails visibly on malformed server metadata rather than returning successful empty choices',async()=>{
 const f=fixture();delete (f.data.decks as Record<string,unknown>[])[0].is_archived;
 await expect(f.read()).rejects.toMatchObject({kind:'invalid'});
});
it('aborts pending sibling reads after one backend failure',async()=>{
 const f=fixture();f.fail('decks');f.hold('arena_guests');
 await expect(f.read()).rejects.toMatchObject({kind:'unavailable'});
 expect(f.calls.find(call=>call.url.pathname.endsWith('/arena_guests'))?.signal?.aborted).toBe(true);
});
it('does not dispatch any request for an expired owner signal',async()=>{
 const f=fixture();const owner=new AbortController();owner.abort();
 await expect(f.read(owner.signal)).rejects.toBeDefined();expect(f.calls).toEqual([]);
});
it('bounds seat references before issuing a query',async()=>{
 const f=fixture();await expect(readLiveGameRoundReferences(f.reader,{groupId:'group',actorId:'alice',seats:Array.from({length:7},()=>seats[0])}))
  .rejects.toMatchObject({kind:'invalid'});expect(f.calls).toEqual([]);
});
it('cancels a pending SDK read when its owner closes',async()=>{
 const f=fixture();f.hold('groups');const owner=new AbortController();
 const pending=f.read(owner.signal);const assertion=expect(pending).rejects.toMatchObject({kind:'unavailable'});
 await vi.waitFor(()=>expect(f.calls).toHaveLength(1));owner.abort();await assertion;
 expect(f.calls[0].signal?.aborted).toBe(true);
});
it('bounds a stalled SDK read with the existing request deadline',async()=>{
 vi.useFakeTimers();const f=fixture();f.hold('groups');
 const pending=f.read();const assertion=expect(pending).rejects.toMatchObject({kind:'unavailable'});
 await vi.advanceTimersByTimeAsync(0);expect(f.calls).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(15001);await assertion;expect(f.calls[0].signal?.aborted).toBe(true);
});
it('shares one total time budget across group verification and the following reads',async()=>{
 vi.useFakeTimers();const f=fixture();f.delayGroup(14000);f.hold('arena_guests');
 const pending=f.read();const assertion=expect(pending).rejects.toMatchObject({kind:'unavailable'});
 await vi.advanceTimersByTimeAsync(14001);expect(f.calls.some(call=>call.url.pathname.endsWith('/arena_guests'))).toBe(true);
 await vi.advanceTimersByTimeAsync(1000);await assertion;
 expect(f.calls.find(call=>call.url.pathname.endsWith('/arena_guests'))?.signal?.aborted).toBe(true);
 expect(vi.getTimerCount()).toBe(0);
});
}
