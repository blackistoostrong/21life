import {expect,it,vi} from 'vitest';
import {createTablePresetController} from '@/lib/table-preset-controller';
import {createTablePresetRepository,tablePresetStorageKey} from '../../packages/data/table-preset-storage';
import {decodeTablePresets,encodeTablePresets,validateTablePresetScope} from '@/lib/table-preset-codec';
import {copyTablePresetDraft,type TablePresetDraft} from '../../packages/domain/table-presets';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={accountId:id(1),groupId:id(2)},other={...scope,accountId:id(9)};
const draft:TablePresetDraft={playerCount:2,startingLife:40,layoutVariant:'opposed',seats:[
 {participantKey:`user:${id(1)}`,deckId:id(3),deckKind:'registered'},
 {participantKey:`guest:${id(4)}`,deckId:id(5),deckKind:'guest'},
]};
function fixture(){
 const values=new Map<string,string>();let identity=10;
 const storage={getItem:vi.fn(async(key:string)=>values.get(key)??null),
  setItem:vi.fn(async(key:string,value:string)=>{values.set(key,value);})};
 const repository=createTablePresetRepository(storage,{decode:decodeTablePresets,encode:encodeTablePresets,validateScope:validateTablePresetScope},
  {randomUUID:()=>id(identity++),now:()=>'2026-11-27T10:00:00.000Z'});
 const ports={repository,readDraft:vi.fn(()=>draft),
  prepare:vi.fn(async(preset:Parameters<typeof copyTablePresetDraft>[0],_signal:AbortSignal)=>({draft:copyTablePresetDraft(preset),references:[],issues:[]})),
  apply:vi.fn()};
 const owner=createTablePresetController(scope,repository);owner.bind(scope,ports);owner.activate();
 return{values,storage,repository,ports,owner};
}
it('CRUD publishes only acknowledged storage snapshots and keeps preview separate from the current setup',async()=>{
 const f=fixture();expect(await f.owner.refresh()).toBe(true);expect(f.owner.view.getSnapshot()).toMatchObject({loaded:true,presets:[]});
 expect(await f.owner.save('Friday')).toBe(true);
 const saved=f.owner.view.getSnapshot().presets[0];
 expect(await f.owner.rename(saved.id,'Saturday')).toBe(true);
 expect(await f.owner.requestLoad(saved.id)).toBe(true);
 expect(f.owner.view.getSnapshot().preview?.name).toBe('Saturday');
 expect(f.ports.prepare).not.toHaveBeenCalled();expect(f.ports.apply).not.toHaveBeenCalled();
 expect(await f.owner.confirmLoad()).toBe(true);expect(f.ports.prepare).toHaveBeenCalledOnce();
 expect(f.ports.apply).toHaveBeenCalledWith({draft,references:[],issues:[]});expect(f.owner.view.getSnapshot().preview).toBeNull();
 expect(await f.owner.remove(saved.id)).toBe(true);expect(f.owner.view.getSnapshot().presets).toEqual([]);
});
it('refuses double submission while the first command owns its acknowledgement',async()=>{
 const f=fixture();let reply!:()=>void;
 f.storage.setItem.mockImplementationOnce(async(key,value)=>{await new Promise<void>(resolve=>{reply=resolve;});f.values.set(key,value);});
 const pending=f.owner.save('Friday');await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));
 expect(f.owner.view.getSnapshot().presets).toEqual([]);expect(await f.owner.save('Friday')).toBe(false);
 expect(f.ports.readDraft).toHaveBeenCalledOnce();reply();expect(await pending).toBe(true);
 expect(f.owner.view.getSnapshot().presets).toHaveLength(1);
});
it('closing a preview does not apply it or perform validation reads',async()=>{
 const f=fixture();await f.owner.save('Friday');const saved=f.owner.view.getSnapshot().presets[0];
 await f.owner.requestLoad(saved.id);f.owner.cancel();
 expect(f.owner.view.getSnapshot().preview).toBeNull();expect(await f.owner.confirmLoad()).toBe(false);
 expect(f.ports.prepare).not.toHaveBeenCalled();expect(f.ports.apply).not.toHaveBeenCalled();
});
it('validates only after confirmation and drops a response after closing during validation',async()=>{
 const f=fixture();await f.owner.save('Friday');await f.owner.requestLoad(f.owner.view.getSnapshot().presets[0].id);
 let reply!:()=>void;f.ports.prepare.mockImplementationOnce(async()=>{await new Promise<void>(resolve=>{reply=resolve;});return{draft,references:[],issues:[]};});
 const pending=f.owner.confirmLoad();await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));
 const signal=f.ports.prepare.mock.calls[0][1];f.owner.cancel();reply();expect(await pending).toBe(false);
 expect(signal.aborted).toBe(true);expect(f.ports.apply).not.toHaveBeenCalled();
});
it('keeps an accepted apply successful when applying closes its own owner',async()=>{
 const f=fixture();await f.owner.save('Friday');await f.owner.requestLoad(f.owner.view.getSnapshot().presets[0].id);
 f.ports.apply.mockImplementationOnce(()=>f.owner.deactivate());
 expect(await f.owner.confirmLoad()).toBe(true);expect(f.ports.apply).toHaveBeenCalledOnce();
 expect(f.owner.view.getSnapshot()).toMatchObject({pending:null,preview:null,error:null});
});
it('a changed or deleted document cannot silently replace the previewed draft',async()=>{
 const f=fixture();await f.owner.save('Friday');const saved=f.owner.view.getSnapshot().presets[0];await f.owner.requestLoad(saved.id);
 const changed={...saved,startingLife:20};
 f.values.set(tablePresetStorageKey(scope),encodeTablePresets([changed],scope));
 expect(await f.owner.confirmLoad()).toBe(false);expect(f.owner.view.getSnapshot()).toMatchObject({error:'changed',preview:{startingLife:20}});
 expect(f.ports.apply).not.toHaveBeenCalled();
 await f.repository.remove(scope,saved.id);expect(await f.owner.confirmLoad()).toBe(false);
 expect(f.owner.view.getSnapshot()).toMatchObject({error:'not_found',preview:null});expect(f.ports.apply).not.toHaveBeenCalled();
});
it('storage/schema failures stay visible without fabricating an empty successful collection',async()=>{
 const f=fixture();await f.owner.save('Friday');const saved=f.owner.view.getSnapshot().presets;
 f.values.set(tablePresetStorageKey(scope),JSON.stringify({schemaVersion:2,...scope,presets:[]}));
 expect(await f.owner.refresh()).toBe(false);
 expect(f.owner.view.getSnapshot()).toMatchObject({error:'unsupported',presets:saved});
 expect(f.ports.apply).not.toHaveBeenCalled();
});
it('late storage ACK remains in the old account without publishing into a new owner',async()=>{
 const f=fixture();let reply!:()=>void;
 f.storage.setItem.mockImplementationOnce(async(key,value)=>{f.values.set(key,value);await new Promise<void>(resolve=>{reply=resolve;});});
 const pending=f.owner.save('Friday');await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));
 const notify=vi.fn();f.owner.view.subscribe(notify);f.owner.deactivate();notify.mockClear();
 const next=createTablePresetController(other,f.repository);next.bind(other,f.ports);next.activate();await next.refresh();
 reply();expect(await pending).toBe(false);expect(f.owner.view.getSnapshot().presets).toEqual([]);expect(notify).not.toHaveBeenCalled();
 expect(next.view.getSnapshot().presets).toEqual([]);expect(await f.repository.list(scope)).toHaveLength(1);
});
it('reactivation cannot adopt an older request and its stale error',async()=>{
 const f=fixture();let reply!:(value:string|null)=>void;
 f.storage.getItem.mockImplementationOnce(()=>new Promise(resolve=>{reply=resolve;}));
 const first=f.owner.refresh();await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));f.owner.deactivate();f.owner.activate();
 const second=f.owner.refresh();reply('{');expect(await first).toBe(false);expect(await second).toBe(true);
 expect(f.owner.view.getSnapshot()).toMatchObject({presets:[],loaded:true,error:null,pending:null});
});
it('an accepted command retains its committed callbacks through same-scope rebinding',async()=>{
 const f=fixture();await f.owner.save('Friday');await f.owner.requestLoad(f.owner.view.getSnapshot().presets[0].id);
 let reply!:()=>void;
 f.ports.prepare.mockImplementationOnce(async()=>{await new Promise<void>(resolve=>{reply=resolve;});return{draft,references:[],issues:[]};});
 const pending=f.owner.confirmLoad();await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));
 const next={...f.ports,apply:vi.fn(),prepare:vi.fn(async()=>({draft,references:[],issues:[]}))};
 f.owner.bind(scope,next);reply();expect(await pending).toBe(true);
 expect(f.ports.apply).toHaveBeenCalledOnce();expect(next.apply).not.toHaveBeenCalled();expect(next.prepare).not.toHaveBeenCalled();
});
it('refuses bindings for another scope without replacing the current command ports',async()=>{
 const f=fixture();expect(()=>f.owner.bind(other,{...f.ports,apply:vi.fn()})).toThrow('TABLE_PRESET_SCOPE');
 expect(await f.owner.save('Friday')).toBe(true);expect(f.ports.readDraft).toHaveBeenCalledOnce();
});
