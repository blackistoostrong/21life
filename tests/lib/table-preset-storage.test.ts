import {expect,it,vi} from 'vitest';
import {createTablePresetRepository,tablePresetStorageKey} from '../../packages/data/table-preset-storage';
import {decodeTablePresets,encodeTablePresets,validateTablePresetScope} from '@/lib/table-preset-codec';
import type {TablePresetDraft} from '../../packages/domain/table-presets';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={accountId:id(1),groupId:id(2)},other={accountId:id(9),groupId:id(2)};
const now='2026-11-27T10:00:00.000Z';
function draft():TablePresetDraft {
 return {playerCount:2,startingLife:40,layoutVariant:'classic',seats:[
  {participantKey:`user:${id(1)}`,deckId:id(3),deckKind:'registered'},
  {participantKey:`guest:${id(4)}`,deckId:id(5),deckKind:'guest'},
 ]};
}
function fixture(){
 const values=new Map<string,string>();let nextId=10;
 const storage={getItem:vi.fn(async(key:string)=>values.get(key)??null),
  setItem:vi.fn(async(key:string,value:string)=>{values.set(key,value);})};
 const repository=createTablePresetRepository(storage,{
  decode:decodeTablePresets,encode:encodeTablePresets,validateScope:validateTablePresetScope,
 },{randomUUID:()=>id(nextId++),now:()=>now});
 return{values,storage,repository};
}
it('persists CRUD across a fresh repository and isolates account/group documents',async()=>{
 const f=fixture();expect(await f.repository.list(scope)).toEqual([]);
 const first=await f.repository.save(scope,'  Friday  ',draft());
 await f.repository.save(other,'Friday',draft());
 await f.repository.save({...scope,groupId:id(8)},'Friday',draft());
 expect(first).toHaveLength(1);expect(first[0].name).toBe('Friday');
 const reopened=createTablePresetRepository(f.storage,{decode:decodeTablePresets,encode:encodeTablePresets,validateScope:validateTablePresetScope},
  {randomUUID:()=>id(99),now:()=>now});
 expect(await reopened.list(scope)).toEqual(first);
 expect((await reopened.rename(scope,first[0].id,'Saturday'))[0].name).toBe('Saturday');
 expect(await reopened.remove(scope,first[0].id)).toEqual([]);
 expect((await reopened.list(other))[0].name).toBe('Friday');
});
it('serializes concurrent saves and enforces the limit against the latest stored document',async()=>{
 const f=fixture();
 const results=await Promise.allSettled(Array.from({length:11},(_,n)=>f.repository.save(scope,`Pod ${n}`,draft())));
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(10);
 expect(results[10]).toMatchObject({status:'rejected',reason:{kind:'limit'}});
 expect(f.storage.setItem).toHaveBeenCalledTimes(10);expect(await f.repository.list(scope)).toHaveLength(10);
});
it('registers accepted saves before awaiting storage, so a subsequent read cannot see an older snapshot',async()=>{
 const f=fixture();let reply!:(value:string|null)=>void;
 f.storage.getItem.mockImplementationOnce(()=>new Promise(resolve=>{reply=resolve;}));
 const saved=f.repository.save(scope,'Friday',draft());const read=f.repository.list(scope);
 await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));
 expect(f.storage.getItem).toHaveBeenCalledOnce();reply(null);
 expect(await saved).toHaveLength(1);expect(await read).toHaveLength(1);
});
it('captures draft and account inputs before its first await',async()=>{
 const f=fixture(),input={...scope},setup={...draft(),seats:[...draft().seats]};let reply!:(value:string|null)=>void;
 f.storage.getItem.mockImplementationOnce(()=>new Promise(resolve=>{reply=resolve;}));
 const saved=f.repository.save(input,'Friday',setup);
 input.accountId=other.accountId;setup.startingLife=3;setup.seats.reverse();
 await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));reply(null);
 const result=await saved;expect(result[0].accountId).toBe(scope.accountId);expect(result[0].startingLife).toBe(40);
 expect(result[0].seats[0].participantKey).toBe(`user:${id(1)}`);
 expect(f.values.has(tablePresetStorageKey(other))).toBe(false);
});
it('a held account does not block another account',async()=>{
 const f=fixture();let reply!:(value:string|null)=>void;
 f.storage.getItem.mockImplementationOnce(()=>new Promise(resolve=>{reply=resolve;}));
 const held=f.repository.save(scope,'Friday',draft());
 await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));
 expect(await f.repository.save(other,'Friday',draft())).toHaveLength(1);
 reply(null);await held;
});
for(const raw of ['{',JSON.stringify({schemaVersion:2,...scope,presets:[],future:'preserve'})]){
 it(`preserves ${raw==='{'?'malformed':'future'} bytes and refuses every mutation`,async()=>{
  const f=fixture(),key=tablePresetStorageKey(scope);f.values.set(key,raw);
  const expected=raw==='{'?'invalid':'unsupported';
  await expect(f.repository.list(scope)).rejects.toMatchObject({kind:expected});
  await expect(f.repository.save(scope,'Friday',draft())).rejects.toMatchObject({kind:expected});
  await expect(f.repository.rename(scope,id(10),'New')).rejects.toMatchObject({kind:expected});
  await expect(f.repository.remove(scope,id(10))).rejects.toMatchObject({kind:expected});
  expect(f.storage.setItem).not.toHaveBeenCalled();expect(f.values.get(key)).toBe(raw);
 });
}
it('read/write failures are visible and a failed queue does not poison later operations',async()=>{
 const f=fixture();f.storage.getItem.mockRejectedValueOnce(Error('Unavailable'));
 await expect(f.repository.save(scope,'Friday',draft())).rejects.toMatchObject({kind:'storage'});
 expect(f.storage.setItem).not.toHaveBeenCalled();
 f.storage.setItem.mockRejectedValueOnce(Error('Quota'));
 await expect(f.repository.save(scope,'Friday',draft())).rejects.toMatchObject({kind:'storage'});
 expect(f.values.has(tablePresetStorageKey(scope))).toBe(false);
 expect((await f.repository.save(scope,'Friday',draft()))[0].name).toBe('Friday');
});
it('does not write or overwrite an existing preset after a cancelled reference/storage read',async()=>{
 const f=fixture();const first=await f.repository.save(scope,'Friday',draft());
 const raw=f.values.get(tablePresetStorageKey(scope));let reply!:(value:string|null)=>void;
 f.storage.getItem.mockImplementationOnce(()=>new Promise(resolve=>{reply=resolve;}));
 const controller=new AbortController();const pending=f.repository.rename(scope,first[0].id,'Changed',controller.signal);
 await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));controller.abort();reply(raw!);
 await expect(pending).rejects.toMatchObject({kind:'cancelled'});
 expect(f.values.get(tablePresetStorageKey(scope))).toBe(raw);
});
it('late acknowledgement remains in its captured account and cannot become a UI success after cancellation',async()=>{
 const f=fixture();let reply!:()=>void;
 f.storage.setItem.mockImplementationOnce(async(key,value)=>{f.values.set(key,value);await new Promise<void>(resolve=>{reply=resolve;});});
 const controller=new AbortController();const pending=f.repository.save(scope,'Friday',draft(),controller.signal);
 await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));controller.abort();reply();
 await expect(pending).rejects.toMatchObject({kind:'cancelled'});
 expect(await f.repository.list(other)).toEqual([]);expect(await f.repository.list(scope)).toHaveLength(1);
});
it('holds the platform lock across the complete read/modify/write and releases it on failure',async()=>{
 const f=fixture();let locked=false;
 const requests=vi.fn();
 const exclusive=async<T>(key:string,work:()=>Promise<T>)=>{
  requests(key);expect(locked).toBe(false);locked=true;try{return await work();}finally{locked=false;}
 };
 const storage={...f.storage,exclusive};
 storage.getItem.mockImplementation(async key=>{expect(locked).toBe(true);return f.values.get(key)??null;});
 storage.setItem.mockImplementation(async(key,value)=>{expect(locked).toBe(true);f.values.set(key,value);});
 const repository=createTablePresetRepository(storage,{decode:decodeTablePresets,encode:encodeTablePresets,validateScope:validateTablePresetScope},
  {randomUUID:()=>id(10),now:()=>now});
 await repository.save(scope,'Friday',draft());expect(locked).toBe(false);
 await expect(repository.save(scope,'Friday',draft())).rejects.toMatchObject({kind:'duplicate'});expect(locked).toBe(false);
 expect(requests).toHaveBeenCalledTimes(2);
});
