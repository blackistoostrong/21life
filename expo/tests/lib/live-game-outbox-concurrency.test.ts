import {beforeEach,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {ArchivedLiveGameOperation} from '@/lib/live-game-offline';
const m=vi.hoisted(()=>({storage:new Map<string,string>(),create:vi.fn(),cancel:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:{
  getItem:async(key:string)=>m.storage.get(key)??null,
  setItem:async(key:string,value:string)=>{m.storage.set(key,value);},
  multiSet:async(entries:[string,string][])=>{for(const[key,value]of entries)m.storage.set(key,value);},
}}));
vi.mock('@/lib/live-game-service',()=>({ensureLiveGameCreated:m.create,cancelLiveGame:m.cancel,
  applyQueuedLiveGameMutations:vi.fn(),finalizePendingLiveGame:vi.fn()}));
import {archiveAndClearLiveGameSession,loadLiveGameOutbox,saveLiveGameOutbox} from '@/lib/live-game-offline';
import {replayLiveGameOutbox} from '@/lib/live-game-outbox-replay';
const client={} as SupabaseClient;
function item(id:string):ArchivedLiveGameOperation{return {id,needsCreate:true,mutations:[],cancel:true,finalization:null,
  serverRecord:{id,created_by:'actor-a',group_id:'group-a',status:'active',starting_life:40,match_id:null,
    started_at:'2026-11-25T12:00:00Z',ended_at:null,created_at:'2026-11-25T12:00:00Z',updated_at:'2026-11-25T12:00:00Z',
    state:{version:0,events:[],players:[]}}};}
beforeEach(()=>{vi.resetAllMocks();m.storage.clear();m.create.mockImplementation(async(_client,record)=>record);m.cancel.mockResolvedValue(undefined);});

it('preserves a newly archived game while an earlier create acknowledgement is in flight',async()=>{
  const first=item('first'),second=item('second');second.needsCreate=false;
  await saveLiveGameOutbox([first],'actor-a');
  let reply!:()=>void;
  m.create.mockImplementationOnce((_client,record)=>new Promise(resolve=>{reply=()=>resolve(record);}));
  m.cancel.mockImplementation(async(_client,id)=>{if(id==='second')throw Error('offline');});
  const replay=replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>true,vi.fn());
  await vi.waitFor(()=>expect(m.create).toHaveBeenCalledTimes(1));
  await archiveAndClearLiveGameSession('group-a',second,'actor-a');
  const assertion=expect(replay).rejects.toThrow('offline');reply();await assertion;
  expect(await loadLiveGameOutbox('actor-a')).toEqual([second]);
});

it('does not overwrite a newer archive of the same game with an older network acknowledgement',async()=>{
  const first=item('first');await saveLiveGameOutbox([first],'actor-a');
  let reply!:()=>void;
  m.create.mockImplementationOnce((_client,record)=>new Promise(resolve=>{reply=()=>resolve(record);}));
  const replay=replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>true,vi.fn());
  await vi.waitFor(()=>expect(m.create).toHaveBeenCalledTimes(1));
  const newer={...first,cancel:false,mutations:[{id:'new-op',mutation:{type:'adjust' as const,targetKey:'user:actor-a' as const,amount:-1,mode:'life' as const}}]};
  await archiveAndClearLiveGameSession('group-a',newer,'actor-a');
  reply();await replay;
  expect(await loadLiveGameOutbox('actor-a')).toEqual([newer]);
  expect(m.cancel).not.toHaveBeenCalled();
});

it('does not resurrect an archive explicitly cleared while its request was pending',async()=>{
  await saveLiveGameOutbox([item('first')],'actor-a');
  let reply!:()=>void;
  m.create.mockImplementationOnce((_client,record)=>new Promise(resolve=>{reply=()=>resolve(record);}));
  const replay=replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>true,vi.fn());
  await vi.waitFor(()=>expect(m.create).toHaveBeenCalledTimes(1));
  await saveLiveGameOutbox([],'actor-a');reply();await replay;
  expect(await loadLiveGameOutbox('actor-a')).toEqual([]);
  expect(m.cancel).not.toHaveBeenCalled();
});

it('a second replay cannot reinsert an item already acknowledged by the first',async()=>{
  await saveLiveGameOutbox([item('first')],'actor-a');
  const replies:Array<()=>void>=[];
  m.create.mockImplementation((_client,record)=>new Promise(resolve=>replies.push(()=>resolve(record))));
  const first=replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>true,vi.fn());
  const second=replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>true,vi.fn());
  await vi.waitFor(()=>expect(replies).toHaveLength(2));
  replies[0]();await first;replies[1]();await second;
  expect(await loadLiveGameOutbox('actor-a')).toEqual([]);
  expect(m.cancel).toHaveBeenCalledTimes(1);
});
