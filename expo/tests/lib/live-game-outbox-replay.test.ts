import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArchivedLiveGameOperation } from '@/lib/live-game-offline';
import { replayLiveGameOutbox } from '@/lib/live-game-outbox-replay';
const m=vi.hoisted(()=>({load:vi.fn(),save:vi.fn(),create:vi.fn(),apply:vi.fn(),finalize:vi.fn(),cancel:vi.fn(),notify:vi.fn()}));
vi.mock('@/lib/live-game-offline',()=>({loadLiveGameOutbox:m.load,saveLiveGameOutbox:m.save}));
vi.mock('@/lib/live-game-service',()=>({ensureLiveGameCreated:m.create,applyQueuedLiveGameMutations:m.apply,
  finalizePendingLiveGame:m.finalize,cancelLiveGame:m.cancel}));
vi.mock('@/lib/api',()=>({apiPost:m.notify}));
const client={} as SupabaseClient;
const item=():ArchivedLiveGameOperation=>({id:'game-a',serverRecord:{id:'game-a',group_id:'group-a',created_by:'actor-a',
  status:'active',starting_life:40,match_id:null,started_at:'2026-11-25T12:00:00Z',ended_at:null,
  created_at:'2026-11-25T12:00:00Z',updated_at:'2026-11-25T12:00:00Z',state:{version:0,events:[],players:[]}},
  needsCreate:true,mutations:[],finalization:null,cancel:true});
beforeEach(()=>{
  vi.resetAllMocks();m.load.mockImplementation(async()=>[item()]);
  m.save.mockResolvedValue(undefined);m.create.mockImplementation(async(_client,record)=>record);
  m.cancel.mockResolvedValue(undefined);
});
it('does not read storage for an expired account scope',async()=>{
  await replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>false, m.notify);
  expect(m.load).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
});
it('does not start network work if the account changes during storage loading',async()=>{
  let active=true;m.load.mockImplementationOnce(async()=>{active=false;return[item()];});
  const publish=vi.fn();await replayLiveGameOutbox(client,'actor-a',publish,()=>active, m.notify);
  expect(m.create).not.toHaveBeenCalled();expect(publish).not.toHaveBeenCalled();
});
it('does not acknowledge a late create response into another account opening',async()=>{
  let active=true;m.create.mockImplementationOnce(async(_client,record)=>{active=false;return record;});
  const publish=vi.fn();await replayLiveGameOutbox(client,'actor-a',publish,()=>active, m.notify);
  expect(m.save).not.toHaveBeenCalled();expect(m.cancel).not.toHaveBeenCalled();
  expect(publish).toHaveBeenCalledTimes(1);
});
it('persists the create acknowledgement before cancellation and then removes the archive',async()=>{
  const writes:ArchivedLiveGameOperation[][]=[];
  m.save.mockImplementation(async items=>{writes.push(structuredClone(items));});
  await replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>true, m.notify);
  expect(m.load).toHaveBeenCalledWith('actor-a');
  expect(writes[0][0].needsCreate).toBe(false);expect(writes.at(-1)).toEqual([]);
  expect(m.cancel).toHaveBeenCalledWith(client,'game-a');
  expect(m.save).toHaveBeenLastCalledWith([],'actor-a');
});
it('keeps archived operations when the create request fails',async()=>{
  m.create.mockRejectedValueOnce(new Error('offline'));
  await expect(replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>true, m.notify)).rejects.toThrow('offline');
  expect(m.save).not.toHaveBeenCalled();expect(m.cancel).not.toHaveBeenCalled();
});
it('persists a mutation acknowledgement before removing the archive',async()=>{
  const archived=item();archived.needsCreate=false;archived.cancel=false;
  archived.mutations=[{id:'m1',mutation:{type:'adjust',targetKey:'user:actor-a',amount:-1,mode:'life'}}];
  m.load.mockResolvedValueOnce([archived]);m.apply.mockImplementation(async(_client,record)=>record);
  const writes:ArchivedLiveGameOperation[][]=[];m.save.mockImplementation(async items=>{writes.push(structuredClone(items));});
  await replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>true,m.notify);
  expect(m.apply).toHaveBeenCalledTimes(1);expect(writes[0][0].mutations).toEqual([]);expect(writes.at(-1)).toEqual([]);
});
it('keeps mutations pending when their acknowledgement belongs to an expired opening',async()=>{
  let active=true;const archived=item();archived.needsCreate=false;
  archived.mutations=[{id:'m1',mutation:{type:'adjust',targetKey:'user:actor-a',amount:-1,mode:'life'}}];
  m.load.mockResolvedValueOnce([archived]);m.apply.mockImplementationOnce(async(_client,record)=>{active=false;return record;});
  await replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>active,m.notify);
  expect(m.save).not.toHaveBeenCalled();expect(archived.mutations).toHaveLength(1);expect(m.cancel).not.toHaveBeenCalled();
});
for(const late of [false,true])it(`finalization ${late?'discards stale completion':'notifies and clears only after acknowledgement'}`,async()=>{
  let active=true;const archived=item();archived.needsCreate=false;archived.cancel=false;
  archived.finalization={winnerKey:null,isDraw:true,winCondition:null,endedAt:'2026-11-25T12:00:00Z',players:[]};
  m.load.mockResolvedValueOnce([archived]);m.finalize.mockImplementationOnce(async()=>{if(late)active=false;return'match-a';});
  await replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>active,m.notify);
  if(late){expect(m.notify).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();}
  else{expect(m.notify).toHaveBeenCalledWith('match-a');expect(m.save).toHaveBeenLastCalledWith([],'actor-a');}
});
it('does not start another command after context changes during persistence',async()=>{
  let active=true;m.save.mockImplementationOnce(async()=>{active=false;});
  const publish=vi.fn();await replayLiveGameOutbox(client,'actor-a',publish,()=>active,m.notify);
  expect(m.cancel).not.toHaveBeenCalled();expect(publish).toHaveBeenCalledTimes(1);
});
it('does not clear an archive after a stale cancellation response',async()=>{
  let active=true;const archived=item();archived.needsCreate=false;
  m.load.mockResolvedValueOnce([archived]);m.cancel.mockImplementationOnce(async()=>{active=false;});
  await replayLiveGameOutbox(client,'actor-a',vi.fn(),()=>active,m.notify);
  expect(m.save).not.toHaveBeenCalled();
});
