import {describe,expect,it} from 'vitest';
import {decodeTablePresets,encodeTablePresets} from '@/lib/table-preset-codec';
import {
  addTablePreset,renameTablePreset,removeTablePreset,copyTablePresetDraft,
  normalizeTablePresetName,type TablePresetDraft,type TablePresetV1,
} from '../../packages/domain/table-presets';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={accountId:id(1),groupId:id(2)};
const draft:TablePresetDraft={playerCount:2,startingLife:40,layoutVariant:'opposed',seats:[
 {participantKey:`user:${id(1)}`,deckId:id(3),deckKind:'occasional'},
 {participantKey:`guest:${id(4)}`,deckId:id(5),deckKind:'guest'},
]};
const now='2026-11-27T10:00:00.000Z';
const add=(presets:readonly TablePresetV1[]=[],name='Friday',identity=id(10))=>
 addTablePreset(presets,scope,{id:identity,name,updatedAt:now,draft});
const document=(presets:unknown)=>JSON.stringify({schemaVersion:1,...scope,presets});

describe('table preset collection policies',()=>{
 it('normalizes the name and preserves seat order, kinds and setup preferences',()=>{
  const presets=add([],'  Friday  ');
  expect(presets[0]).toEqual({...draft,...scope,schemaVersion:1,id:id(10),name:'Friday',updatedAt:now});
  expect(presets[0].seats).not.toBe(draft.seats);
  expect(presets[0].seats[0]).not.toBe(draft.seats[0]);
 });
 it('copies only preferences and never retains live state, credentials or arbitrary fields',()=>{
  const source={...draft,token:'private',state:{life:2},seats:draft.seats.map(seat=>({...seat,life:1,commander:'Secret metadata'}))};
  expect(copyTablePresetDraft(source)).toEqual(draft);
 });
 it('rejects a case-insensitive duplicate but permits renaming the same preset with another case',()=>{
  const presets=add();expect(()=>add(presets,'  FRIDAY ',id(11))).toThrow('TABLE_PRESET_DUPLICATE');
  expect(renameTablePreset(presets,scope,id(10),'FRIDAY',now)[0].name).toBe('FRIDAY');
  expect(presets[0].name).toBe('Friday');
 });
 it('keeps accents and counts Unicode code points rather than UTF-16 units',()=>{
  expect(normalizeTablePresetName('  e\u0301  ')).toBe('é');
  expect(normalizeTablePresetName('😀'.repeat(40))).toHaveLength(80);
  expect(()=>normalizeTablePresetName('😀'.repeat(41))).toThrow('TABLE_PRESET_NAME');
 });
 it.each(['','  ','a'.repeat(41),'first\u0000second','first\nsecond'])('rejects invalid name %j',name=>{
  expect(()=>add([],name)).toThrow('TABLE_PRESET_NAME');
 });
 it('accepts ten presets and rejects the eleventh without changing existing records',()=>{
  let presets:TablePresetV1[]=[];
  for(let n=0;n<10;n++)presets=add(presets,`Pod ${n}`,id(10+n));
  const before=JSON.stringify(presets);
  expect(()=>add(presets,'Eleventh',id(20))).toThrow('TABLE_PRESET_LIMIT');
  expect(JSON.stringify(presets)).toBe(before);
 });
 it('rejects colliding identities, unknown targets and mutations in another scope',()=>{
  const presets=add();
  expect(()=>add(presets,'Another')).toThrow('TABLE_PRESET_DUPLICATE');
  expect(()=>renameTablePreset(presets,scope,id(99),'New',now)).toThrow('TABLE_PRESET_NOT_FOUND');
  expect(()=>removeTablePreset(presets,scope,id(99))).toThrow('TABLE_PRESET_NOT_FOUND');
  expect(()=>removeTablePreset(presets,{...scope,accountId:id(6)},id(10))).toThrow('TABLE_PRESET_SCOPE');
 });
 it('rename and delete preserve unrelated presets and setup preferences',()=>{
  const presets=add(add(),'Saturday',id(11));
  const renamed=renameTablePreset(presets,scope,id(10),'New Friday','2026-11-28T10:00:00.000Z');
  expect(renamed[1]).toBe(presets[1]);expect(renamed[0].seats).toEqual(draft.seats);
  expect(removeTablePreset(renamed,scope,id(10))).toEqual([presets[1]]);
 });
});

describe('strict persisted preset document',()=>{
 it('roundtrips the real Zod codec, including guest and occasional IDs',()=>{
  const presets=add();expect(decodeTablePresets(encodeTablePresets(presets,scope),scope)).toEqual(presets);
  expect(decodeTablePresets(null,scope)).toEqual([]);
 });
 it('permits unassigned seats without inventing references',()=>{
  const value=add()[0];
  const presets=[{...value,seats:[{participantKey:null,deckId:null,deckKind:null},
   {participantKey:`user:${id(1)}` as const,deckId:null,deckKind:null}]}];
  expect(decodeTablePresets(encodeTablePresets(presets,scope),scope)[0].seats).toEqual(presets[0].seats);
 });
 it.each([['empty',''],['truncated','{'],['null','null'],['array','[]'],['oversized','x'.repeat(65537)]])('does not treat %s storage as empty',(_label,raw)=>{
  expect(()=>decodeTablePresets(raw,scope)).toThrow('TABLE_PRESET_INVALID');
 });
 it('distinguishes future schemas and another account/group without changing the original bytes',()=>{
  const presets=add(),raw=document(presets);
  expect(()=>decodeTablePresets(raw,{...scope,accountId:id(6)})).toThrow('TABLE_PRESET_SCOPE');
  expect(()=>decodeTablePresets(raw,{...scope,groupId:id(6)})).toThrow('TABLE_PRESET_SCOPE');
  const future=JSON.stringify({schemaVersion:2,...scope,presets,unknown:'preserve'});
  expect(()=>decodeTablePresets(future,scope)).toThrow('TABLE_PRESET_UNSUPPORTED');
  expect(future).toContain('preserve');
 });
 it.each([
  {access_token:'private'}, {schemaVersion:2}, {name:''}, {name:' '}, {name:'a'.repeat(41)}, {startingLife:0}, {startingLife:1.5},
  {playerCount:3}, {layoutVariant:'unknown'}, {updatedAt:'yesterday'}, {id:'not-an-id'},
 ])('rejects unsupported record fields or malformed values: %j',change=>{
  expect(()=>decodeTablePresets(document([{...add()[0],...change}]),scope)).toThrow('TABLE_PRESET_INVALID');
 });
 it('rejects duplicate participants, duplicate names/IDs and record scope mismatches',()=>{
  const first=add()[0];
  expect(()=>decodeTablePresets(document([{...first,seats:[first.seats[0],first.seats[0]]}]),scope)).toThrow('TABLE_PRESET_INVALID');
  expect(()=>decodeTablePresets(document([first,{...first,id:id(11),name:'FRIDAY'}]),scope)).toThrow('TABLE_PRESET_INVALID');
  expect(()=>decodeTablePresets(document([first,{...first,name:'Different'}]),scope)).toThrow('TABLE_PRESET_INVALID');
  expect(()=>decodeTablePresets(document([{...first,groupId:id(7)}]),scope)).toThrow('TABLE_PRESET_INVALID');
 });
 it.each([
  {participantKey:null,deckId:id(5),deckKind:'guest'},
  {participantKey:7,deckId:id(5),deckKind:'guest'},
  {participantKey:{kind:'guest'},deckId:id(5),deckKind:'guest'},
  {participantKey:`guest:${id(4)}`,deckId:id(5),deckKind:'registered'},
  {participantKey:`user:${id(1)}`,deckId:id(3),deckKind:'guest'},
  {participantKey:`user:${id(1)}`,deckId:null,deckKind:'registered'},
  {participantKey:'user:invalid',deckId:id(3),deckKind:'registered'},
 ])('rejects inconsistent seat references: %j',seat=>{
  const value=add()[0];
  expect(()=>decodeTablePresets(JSON.stringify({schemaVersion:1,...scope,presets:[{...value,seats:[seat,value.seats[1]]}]}),scope))
   .toThrow('TABLE_PRESET_INVALID');
 });
 it('rejects unexpected envelope keys and duplicate-name documents on encoding too',()=>{
  const presets=add();
  expect(()=>decodeTablePresets(JSON.stringify({schemaVersion:1,...scope,presets,token:'private'}),scope)).toThrow('TABLE_PRESET_INVALID');
  expect(()=>encodeTablePresets([...presets,{...presets[0],id:id(11)}],scope)).toThrow('TABLE_PRESET_INVALID');
 });
});
