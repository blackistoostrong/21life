import {tablePresets} from '../../lib/table-presets';
import {tablePresetStorageKey} from '../../packages/data/table-preset-storage';
import type {TablePresetScope, TablePresetDraft} from '../../packages/domain/table-presets';

const draft:TablePresetDraft={playerCount:2,startingLife:40,layoutVariant:'classic',seats:[
 {participantKey:null,deckId:null,deckKind:null},{participantKey:null,deckId:null,deckKind:null},
]};
let held=false;
let release:()=>void=()=>{};
let controller:AbortController|null=null;
let pending:Promise<string>|null=null;
Object.assign(window,{presetStorageHarness:{
 save:(scope:TablePresetScope,name:string)=>tablePresets.save(scope,name,draft),
 many:(scope:TablePresetScope,prefix:string,count:number)=>Promise.all(Array.from({length:count},(_,n)=>
  tablePresets.save(scope,`${prefix} ${n}`,draft).then(()=> 'saved',error=>String(error.kind)))),
 list:(scope:TablePresetScope)=>tablePresets.list(scope),
 raw:(scope:TablePresetScope)=>localStorage.getItem(tablePresetStorageKey(scope)),
 future:(scope:TablePresetScope)=>localStorage.setItem(tablePresetStorageKey(scope),JSON.stringify({schemaVersion:2,...scope,presets:[],future:'preserve'})),
 hold:(scope:TablePresetScope)=>{void navigator.locks.request(tablePresetStorageKey(scope),async()=>{
  held=true;await new Promise<void>(resolve=>{release=resolve;});held=false;
 });},
 held:()=>held,release:()=>release(),
 begin:(scope:TablePresetScope)=>{controller=new AbortController();pending=tablePresets.save(scope,'Cancelled',draft,controller.signal)
  .then(()=> 'saved',error=>String(error.kind));},
 abort:()=>controller?.abort(),result:()=>pending,
}});
