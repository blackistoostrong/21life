import {expect,it,vi} from 'vitest';
import {prepareTablePresetReferences} from '../../packages/data/table-preset-references';
import type {TablePresetV1} from '../../packages/domain/table-presets';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const preset:TablePresetV1={schemaVersion:1,id:id(10),name:'Friday',accountId:id(1),groupId:id(2),updatedAt:'2026-11-27T10:00:00Z',
  playerCount:2,startingLife:40,layoutVariant:'opposed',seats:[
   {participantKey:`user:${id(1)}`,deckId:id(3),deckKind:'registered'},
   {participantKey:`guest:${id(4)}`,deckId:id(5),deckKind:'guest'},
  ]};
 const group={id:id(2),group_members:[{user_id:id(1),profiles:{id:id(1),username:'alice',display_name:'Alice now'}}]};
 const decks=[{id:id(3),user_id:id(1),group_id:null,name:'Named A',commander:'Current A',commander_image:null,is_archived:false,source_type:'manual'}];
 const guests=[{id:id(4),group_id:id(2),display_name:'Guest now'}];
 const guestDecks=[{id:id(5),guest_id:id(4),group_id:id(2),name:'Named G',commander:'Current G',commander_image:null}];
 const reader={group:vi.fn(async()=>({data:group,error:null})),decks:vi.fn(async()=>({data:decks,error:null})),
  guests:vi.fn(async()=>({data:guests,error:null})),guestDecks:vi.fn(async()=>({data:guestDecks,error:null}))};
 return{preset,group,decks,guests,guestDecks,reader};
}
it('prepares current selected references without inserting decks or changing slot order/life/layout',async()=>{
 const f=fixture();f.decks[0].source_type='occasional';
 const result=await prepareTablePresetReferences(f.preset,f.reader);
 expect(result.draft).toMatchObject({playerCount:2,startingLife:40,layoutVariant:'opposed',seats:[
  {participantKey:`user:${id(1)}`,deckId:id(3),deckKind:'occasional'},
  {participantKey:`guest:${id(4)}`,deckId:id(5),deckKind:'guest'},
 ]});
 expect(result.references.map(row=>[row.displayName,row.deckName,row.commander,row.deckKind])).toEqual([
  ['Alice now','Named A','Current A','occasional'],['Guest now','Named G','Current G','guest'],
 ]);
 expect(result.issues).toEqual([]);expect(f.preset.seats[0].deckKind).toBe('registered');
 expect(f.reader.decks).toHaveBeenCalledWith([id(3)],expect.any(AbortSignal));
 expect(f.reader.guestDecks).toHaveBeenCalledWith(id(2),[id(5)],expect.any(AbortSignal));
});
for(const unavailable of ['deleted','archived','historical'] as const){
 it(`clears only a ${unavailable} deck reference and preserves its participant`,async()=>{
  const f=fixture();if(unavailable==='deleted')f.decks.splice(0);else if(unavailable==='archived')f.decks[0].is_archived=true;
  else f.decks[0].source_type='historical';
  const result=await prepareTablePresetReferences(f.preset,f.reader);
  expect(result.draft.seats[0]).toEqual({participantKey:`user:${id(1)}`,deckId:null,deckKind:null});
  expect(result.draft.seats[1]).toEqual(f.preset.seats[1]);expect(result.references).toHaveLength(1);
  expect(result.issues).toHaveLength(1);
 });
}
it('clears a removed guest without substituting a participant',async()=>{
 const f=fixture();f.guests.splice(0);const result=await prepareTablePresetReferences(f.preset,f.reader);
 expect(result.draft.seats[1]).toEqual({participantKey:null,deckId:null,deckKind:null});expect(result.draft.seats[0]).toEqual(f.preset.seats[0]);
 expect(result.issues).toEqual([{seat:1,reason:'participant_missing'}]);
});
it('clears a removed selected member while the actor still has access to the group',async()=>{
 const f=fixture();const preset={...f.preset,seats:[{...f.preset.seats[0],participantKey:`user:${id(9)}` as const},f.preset.seats[1]]};
 f.decks[0].user_id=id(9);const result=await prepareTablePresetReferences(preset,f.reader);
 expect(result.draft.seats[0]).toEqual({participantKey:null,deckId:null,deckKind:null});
 expect(result.issues).toEqual([{seat:0,reason:'participant_missing'}]);
});
it('denied actor membership stops before reading any deck or guest data',async()=>{
 const f=fixture();f.group.group_members.splice(0);
 await expect(prepareTablePresetReferences(f.preset,f.reader)).rejects.toMatchObject({kind:'scope'});
 expect(f.reader.decks).not.toHaveBeenCalled();expect(f.reader.guests).not.toHaveBeenCalled();
});
it('transport failures remain unavailable rather than accepting the stored references',async()=>{
 const f=fixture();f.reader.group.mockRejectedValueOnce(Error('Offline'));
 await expect(prepareTablePresetReferences(f.preset,f.reader)).rejects.toMatchObject({kind:'references'});
});
it('already-aborted validation performs no transport and cannot apply a preset',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 await expect(prepareTablePresetReferences(f.preset,f.reader,controller.signal)).rejects.toMatchObject({kind:'cancelled'});
 expect(f.reader.group).not.toHaveBeenCalled();
});
