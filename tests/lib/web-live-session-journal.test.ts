import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createLiveGamePlayer,applyLiveGameMutation,type LiveGameRecord} from '@/lib/live-game';
import {createWebLiveSessionJournal} from '@/lib/web-live-session-journal';

function fixture():LiveGameRecord{
  return {id:'game',group_id:'group',created_by:'alice',status:'active',starting_life:40,
    state:{version:0,events:[],players:['user:alice','user:bob'].map((participantKey,slot)=>createLiveGamePlayer({
      slot,participantKey:participantKey as 'user:alice'|'user:bob',deckId:`deck-${slot}`,displayName:participantKey,
      commander:'Commander',commanderImage:null,startingLife:40,allParticipantKeys:['user:alice','user:bob'],
    }))},match_id:null,started_at:'2026-11-26T00:00:00Z',ended_at:null,
    created_at:'2026-11-26T00:00:00Z',updated_at:'2026-11-26T00:00:00Z'};
}
let values:Map<string,string>;
beforeEach(()=>{
  values=new Map();
  vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}}});
});
afterEach(()=>vi.unstubAllGlobals());
const life=(owner:ReturnType<typeof createWebLiveSessionJournal>)=>owner.getSnapshot().record?.state.players[0].life;

it('keeps optimistic undo/redo and operation IDs durable through its public actions',()=>{
  const owner=createWebLiveSessionJournal('group','alice');owner.activate();owner.start(fixture());owner.persist();
  expect(owner.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'},
    {type:'adjust',targetKey:'user:alice',amount:-1,mode:'life'})).toBe(true);
  expect(life(owner)).toBe(39);expect(owner.getSnapshot().history.undo).toHaveLength(1);
  expect(owner.undo()).toBe(true);expect(life(owner)).toBe(40);
  expect(owner.redo()).toBe(true);expect(life(owner)).toBe(39);
  const saved=owner.readSaved().journal!;
  expect(saved.mutations).toEqual(owner.getSnapshot().mutations);
  expect(new Set(saved.mutations.map(item=>item.id)).size).toBe(3);
  expect(owner.pendingCount()).toBe(4); // Three mutations plus pending creation.
});

it('acknowledges only the queued prefix while preserving a mutation appended during flight',()=>{
  const owner=createWebLiveSessionJournal('group','alice');owner.activate();const initial=fixture();owner.start(initial);
  owner.acceptCreated(initial);
  owner.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'});
  const batch=owner.getSnapshot().mutations.slice();
  owner.enqueue({type:'adjust',targetKey:'user:alice',amount:2,mode:'life'});
  const remote={...initial,state:applyLiveGameMutation(initial.state,batch[0].mutation)};
  expect(owner.acknowledgeBatch(remote,batch)).toBe(true);
  expect(life(owner)).toBe(37);expect(owner.getSnapshot().mutations).toHaveLength(1);
  expect(owner.readSaved().journal?.mutations).toEqual(owner.getSnapshot().mutations);
  const before=owner.getSnapshot();
  expect(owner.acknowledgeBatch(remote,batch)).toBe(false);expect(owner.getSnapshot()).toBe(before);
});

it('keeps the previous opening inert after another opening acquires the same account/group',()=>{
  const old=createWebLiveSessionJournal('group','alice');old.activate();old.start(fixture());old.persist();old.deactivate();
  const next=createWebLiveSessionJournal('group','alice');next.activate();next.restore(next.readSaved().journal!);
  const bytes=Array.from(values.entries());
  expect(old.finish('game')).toBe(false);expect(old.enqueue({type:'adjust',targetKey:'user:alice',amount:-5,mode:'life'})).toBe(false);
  old.persist();expect(Array.from(values.entries())).toEqual(bytes);expect(life(next)).toBe(40);
  const other=createWebLiveSessionJournal('group','bob');other.activate();expect(other.readSaved().journal).toBeNull();
});

it('retains corrupted persisted bytes and reports failure without discarding the playable state',()=>{
  const key='phyrexian-arena:web-live-game:v2:alice:group';values.set(key,'{broken');
  const owner=createWebLiveSessionJournal('group','alice');owner.activate();owner.start(fixture());owner.persist();
  expect(owner.getSnapshot().error).toBe('invalid');expect(values.get(key)).toBe('{broken');expect(life(owner)).toBe(40);
});

it('publishes stable snapshots and releases its observer without treating no-op persistence as a mutation',()=>{
  const owner=createWebLiveSessionJournal('group','alice');const changed=vi.fn();owner.activate();const stop=owner.subscribe(changed);
  owner.start(fixture());const before=owner.getSnapshot();owner.persist();
  expect(owner.getSnapshot()).toBe(before);expect(changed).toHaveBeenCalledTimes(1);
  stop();owner.requestCancellation();expect(changed).toHaveBeenCalledTimes(1);
  expect(owner.readSaved().journal?.pendingCancel).toBe(true);
  expect(owner.finish('another-game')).toBe(false);
  expect(owner.finish('game')).toBe(true);expect(owner.readSaved().journal).toBeNull();
});

it('keeps an unacknowledged round when start or resume attempts to replace it',()=>{
  const owner=createWebLiveSessionJournal('group','alice');owner.activate();const first=fixture();owner.start(first);owner.persist();
  const next={...fixture(),id:'next'};const bytes=Array.from(values.entries());
  expect(owner.start(next)).toBe(false);expect(owner.resume(next)).toBe(false);
  expect(owner.getSnapshot().record?.id).toBe('game');expect(owner.getSnapshot().error).toBe('pending_game');
  expect(Array.from(values.entries())).toEqual(bytes);
  owner.finish('game');expect(owner.resume(next)).toBe(true);expect(owner.getSnapshot().record?.id).toBe('next');
});

it('replays current pending mutations over the authoritative snapshot and restores terminal intent',()=>{
  const owner=createWebLiveSessionJournal('group','alice');owner.activate();const initial=fixture();owner.start(initial);owner.acceptCreated(initial);
  owner.enqueue({type:'adjust',targetKey:'user:alice',amount:2,mode:'life'});
  const remote={...initial,state:applyLiveGameMutation(initial.state,{type:'adjust',targetKey:'user:alice',amount:1,mode:'life'})};
  expect(owner.applyRemote(remote)).toBe(true);expect(life(owner)).toBe(37);
  const terminal={winnerKey:null,isDraw:true,winCondition:null,endedAt:'2026-11-26T00:10:00Z',players:[]};
  owner.requestFinalization(terminal);
  const restored=createWebLiveSessionJournal('group','alice');restored.activate();restored.restore(restored.readSaved().journal!);
  expect(restored.getSnapshot().pendingFinalization).toEqual(terminal);
  expect(restored.getSnapshot().mutations).toEqual(owner.getSnapshot().mutations);expect(life(restored)).toBe(37);
  expect(restored.applyRemote({...remote,id:'other'})).toBe(false);
});
