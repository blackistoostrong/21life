import {randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {createLiveGameRound} from '@/lib/live-game-round';
import {applyLiveGameMutation} from '@/lib/live-game';
import {createNativeLiveSessionJournal} from '@/lib/native-live-session-journal';
import {loadLiveGameOfflineSession,loadLiveGameOutbox} from '@/lib/live-game-offline';

const {values,multiSet}=vi.hoisted(()=>{
  const values=new Map<string,string>();
  return {values,multiSet:vi.fn(async(entries:[string,string][])=>{entries.forEach(([key,value])=>values.set(key,value));})};
});
vi.mock('@react-native-async-storage/async-storage',()=>({default:{
  getItem:vi.fn(async(key:string)=>values.get(key)??null),multiSet,
  setItem:vi.fn(async(key:string,value:string)=>{values.set(key,value);}),removeItem:vi.fn(async(key:string)=>{values.delete(key);}),
}}));

beforeEach(()=>{values.clear();vi.clearAllMocks();});
function round(id='game',actor='alice',group='group'){
  return createLiveGameRound({id,groupId:group,actorId:actor,startedAt:'2026-11-26T00:00:00Z',startingLife:40,layoutVariant:'classic',random:()=>0,
    seats:[{participantKey:`user:${actor}`,deckId:'deck',displayName:actor,commander:'A',commanderImage:null},
      {participantKey:'guest:guest',deckId:'guest-deck',displayName:'Guest',commander:'B',commanderImage:null}]});
}
function owner(actor='alice',group='group'){
  const value=createNativeLiveSessionJournal(group,actor,{isCurrent:()=>true,randomUUID});value.activate();return value;
}
function hold(){
  let release!:()=>void;let entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});
  multiSet.mockImplementationOnce(async entries=>{entered();await gate;entries.forEach(([key,value])=>values.set(key,value));});
  return {release,started};
}

it('keeps undo redo and operation IDs in the durable snapshot through typed actions',async()=>{
  const journal=owner();journal.start(round());await journal.persist();
  await journal.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'},
    {type:'adjust',targetKey:'user:alice',amount:-1,mode:'life'});
  expect(journal.getSnapshot().record?.state.players[0].life).toBe(39);
  await journal.undo();expect(journal.getSnapshot().record?.state.players[0].life).toBe(40);
  await journal.redo();expect(journal.getSnapshot().record?.state.players[0].life).toBe(39);
  expect((await journal.loadSaved())?.mutations).toEqual(journal.getSnapshot().mutations);
  expect(journal.pendingCount()).toBe(4);
});

it('registers accepted snapshots before a remount read even after deactivation',async()=>{
  const journal=owner();journal.start(round());const gate=hold();
  const first=journal.persist();await gate.started;
  const second=journal.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'})!;
  const restored=loadLiveGameOfflineSession('group','alice');journal.deactivate();gate.release();
  expect((await restored)?.record.state.players[0].life).toBe(39);await Promise.all([first,second]);
  expect(journal.enqueue({type:'adjust',targetKey:'user:alice',amount:5,mode:'life'})).toBeNull();
});

it('preserves mutations appended after dispatch and rejects duplicate or foreign acknowledgements',async()=>{
  const journal=owner();const initial=round();journal.start(initial);journal.acceptCreated(initial);
  await journal.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'});
  const batch=journal.getSnapshot().mutations.slice();
  await journal.enqueue({type:'adjust',targetKey:'user:alice',amount:2,mode:'life'});
  const remote={...initial,state:applyLiveGameMutation(initial.state,batch[0].mutation)};
  expect(journal.acknowledgeBatch(remote,batch)).toBe(true);await journal.persist();
  expect(journal.getSnapshot().record?.state.players[0].life).toBe(37);
  expect(journal.getSnapshot().mutations).toHaveLength(1);
  expect(journal.acknowledgeBatch(remote,batch)).toBe(false);
  expect(journal.applyRemote({...remote,group_id:'other'})).toBe(false);
});

it('archives terminal intent after accepted snapshots without resurrecting the cleared journal',async()=>{
  const journal=owner();journal.start(round());const gate=hold();
  const first=journal.persist();await gate.started;
  const second=journal.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'})!;
  const terminal={winnerKey:null,isDraw:true,winCondition:null,endedAt:'2026-11-26T00:10:00Z',players:[]};
  const closing=journal.archive(terminal,false);
  expect(journal.start(round('interrupt'))).toBe(false);
  gate.release();await Promise.all([first,second,closing]);
  expect(await loadLiveGameOfflineSession('group','alice')).toBeNull();
  const archived=await loadLiveGameOutbox('alice');expect(archived).toHaveLength(1);
  expect(archived[0].mutations).toHaveLength(1);expect(archived[0].finalization).toEqual(terminal);
  expect(journal.getSnapshot().closed).toBe(true);expect(journal.getSnapshot().record).toBeNull();
  expect(journal.start(round('next'))).toBe(true);await journal.persist();
  expect((await journal.loadSaved())?.record.id).toBe('next');
});

it('leaves the playable journal and corrupted outbox bytes intact if archival fails',async()=>{
  const journal=owner();journal.start(round());await journal.persist();
  const key='phyrexian-arena:live-game:v3:outbox:alice';values.set(key,'{broken');
  await expect(journal.archive(null,true)).rejects.toThrow();
  expect(values.get(key)).toBe('{broken');expect((await journal.loadSaved())?.record.id).toBe('game');
  expect(journal.getSnapshot().closed).toBe(false);expect(journal.getSnapshot().localPersistenceAvailable).toBe(false);
});

it('does not discard a pending snapshot when an authoritative lookup returns no game',async()=>{
  const journal=owner();const initial=round();journal.start(initial);journal.acceptCreated(initial);
  await journal.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'});
  expect(await journal.forgetClean()).toBe(false);expect((await journal.loadSaved())?.mutations).toHaveLength(1);
  const batch=journal.getSnapshot().mutations.slice();
  const remote={...initial,state:applyLiveGameMutation(initial.state,batch[0].mutation)};
  journal.acknowledgeBatch(remote,batch);await journal.persist();
  expect(await journal.forgetClean()).toBe(true);expect(await journal.loadSaved()).toBeNull();
});

it('archives pending operations before replacing an acknowledged server game and resets terminal history',async()=>{
  const journal=owner();const initial=round();journal.start(initial);journal.acceptCreated(initial);
  await journal.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'},
    {type:'adjust',targetKey:'user:alice',amount:-1,mode:'life'});
  expect(await journal.replaceRemote(round('remote'))).toBe(true);await journal.persist();
  expect((await loadLiveGameOutbox('alice'))[0].mutations).toHaveLength(1);
  expect(journal.getSnapshot().record?.id).toBe('remote');expect(journal.getSnapshot().history.undo).toHaveLength(0);
  expect(journal.getSnapshot().mutations).toHaveLength(0);
});

it('keeps snapshots scoped and stable without notifying on a no-op durable acknowledgement',async()=>{
  const journal=owner();const changed=vi.fn();const stop=journal.view.subscribe(changed);
  expect(journal.start(round('foreign','bob','other'))).toBe(false);
  journal.start(round());const before=journal.getSnapshot();await journal.persist();
  expect(journal.getSnapshot()).toBe(before);expect(changed).toHaveBeenCalledTimes(1);
  stop();journal.deactivate();expect(await journal.archive(null,true)).toBe(false);
  expect((await loadLiveGameOfflineSession('group','alice'))?.record.id).toBe('game');
});

it('replays local operations over refreshed server state without losing their IDs on restore',async()=>{
  const journal=owner();const initial=round();journal.start(initial);journal.acceptCreated(initial);
  await journal.enqueue({type:'adjust',targetKey:'user:alice',amount:2,mode:'life'});
  const remote={...initial,state:applyLiveGameMutation(initial.state,{type:'adjust',targetKey:'user:alice',amount:1,mode:'life'})};
  expect(journal.applyRemote(remote)).toBe(true);expect(await journal.replaceRemote(remote)).toBe(true);await journal.persist();
  const restored=owner();expect(restored.restore((await restored.loadSaved())!)).toBe(true);
  expect(restored.getSnapshot().record?.state.players[0].life).toBe(37);
  expect(restored.getSnapshot().mutations).toEqual(journal.getSnapshot().mutations);
});

it.each(['forgetClean','closeRemote','acknowledgeCancellation'] as const)('preserves the snapshot if %s cannot clear storage and allows retry',async action=>{
  const journal=owner();const initial=round();journal.start(initial);journal.acceptCreated(initial);await journal.persist();
  const bytes=Array.from(values.entries());
  const run=()=>action==='acknowledgeCancellation'?journal.acknowledgeCancellation(initial.id):journal[action]();
  multiSet.mockRejectedValueOnce(Error('Storage unavailable'));
  await expect(run()).rejects.toThrow('Storage unavailable');
  expect(Array.from(values.entries())).toEqual(bytes);expect(journal.getSnapshot().record?.id).toBe(initial.id);
  expect(journal.getSnapshot().closed).toBe(false);expect(journal.getSnapshot().localPersistenceAvailable).toBe(false);
  expect(await run()).toBe(true);expect(await journal.loadSaved()).toBeNull();
});

it('keeps unsigned and unrelated owners from reading or adopting a private snapshot',async()=>{
  const unsigned=createNativeLiveSessionJournal(undefined,undefined,{isCurrent:()=>true,randomUUID});unsigned.activate();
  expect(await unsigned.loadSaved()).toBeNull();expect(unsigned.start(round())).toBe(false);await unsigned.persist();
  const unrelated=owner('charlie');expect(unrelated.restore({record:round(),serverRecord:round(),needsCreate:false,mutations:[],
    pendingFinalization:null,pendingCancel:false,history:{undo:[],redo:[]}})).toBe(false);
  expect(await unrelated.replaceRemote(round())).toBe(false);expect(unrelated.acceptCreated(round())).toBe(false);
  expect(values.size).toBe(0);
});

it('does not replace a pending offline creation with a different remote round',async()=>{
  const journal=owner();journal.start(round());await journal.persist();const bytes=Array.from(values.entries());
  expect(await journal.replaceRemote(round('other'))).toBe(false);expect(journal.start(round('other'))).toBe(false);
  expect(Array.from(values.entries())).toEqual(bytes);expect(journal.getSnapshot().record?.id).toBe('game');
});

it('unseals the original round when replacement archival cannot preserve the outbox',async()=>{
  const journal=owner();const initial=round();journal.start(initial);journal.acceptCreated(initial);
  await journal.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'});
  values.set('phyrexian-arena:live-game:v3:outbox:alice','{broken');
  await expect(journal.replaceRemote(round('other'))).rejects.toThrow();
  expect(journal.getSnapshot().record?.id).toBe('game');expect(journal.getSnapshot().mutations).toHaveLength(1);
  expect(journal.getSnapshot().closed).toBe(false);expect((await journal.loadSaved())?.mutations).toHaveLength(1);
});

it('restores the creator of a guest-only table without requiring a registered player seat',async()=>{
  const guests=createLiveGameRound({id:'guest-game',groupId:'group',actorId:'alice',startedAt:'2026-11-26T00:00:00Z',
    startingLife:40,layoutVariant:'classic',random:()=>0,seats:['one','two'].map(id=>({participantKey:`guest:${id}` as const,
      deckId:`deck-${id}`,displayName:id,commander:'Guest',commanderImage:null}))});
  const journal=owner();expect(journal.start(guests)).toBe(true);await journal.persist();
  const restored=owner();expect(restored.restore((await restored.loadSaved())!)).toBe(true);
  expect(restored.getSnapshot().record?.id).toBe('guest-game');
});

it('preserves restored cancellation intent until an acknowledged terminal clear',async()=>{
  const journal=owner();const initial=round();journal.restore({record:initial,serverRecord:initial,mutations:[],needsCreate:false,
    pendingFinalization:null,pendingCancel:true,history:{undo:[],redo:[]}});await journal.persist();
  expect(journal.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'})).toBeNull();
  expect(await journal.closeRemote()).toBe(false);expect(await journal.acknowledgeCancellation('other')).toBe(false);
  expect(await journal.acknowledgeCancellation(initial.id)).toBe(true);expect(await journal.loadSaved()).toBeNull();
  expect(journal.undo()).toBeNull();expect(journal.redo()).toBeNull();
});
