import {expect,it} from 'vitest';
import {liveGameReferenceStamp,reconcileLiveGameReferences,type LiveGameReferenceParticipant} from '../../packages/domain/live-game-reference-validation';

const seats=[{participantKey:'user:alice' as const,deckId:'deck-a'},{participantKey:'guest:bob' as const,deckId:'deck-b'}];
const catalog:LiveGameReferenceParticipant[]=[
 {key:'user:alice',displayName:'Alice now',decks:[{id:'deck-a',commander:'Current A',commanderImage:null}]},
 {key:'guest:bob',displayName:'Bob',decks:[{id:'deck-b',commander:'B',commanderImage:'art-b'}]},
];
it('preserves seat order and IDs, using current metadata without changing the source',()=>{
 const before=JSON.stringify({seats,catalog});const result=reconcileLiveGameReferences(seats,catalog,{allowArchived:true});
 expect(result.issues).toEqual([]);expect(result.seats).toEqual(seats);
 expect(result.resolved.map(value=>[value.participantKey,value.commander])).toEqual([['user:alice','Current A'],['guest:bob','B']]);
 expect(JSON.stringify({seats,catalog})).toBe(before);
});
it('clears only the removed participant seat',()=>{
 const result=reconcileLiveGameReferences(seats,catalog.slice(0,1),{allowArchived:true});
 expect(result.seats).toEqual([seats[0],{participantKey:null,deckId:null}]);
 expect(result.issues).toEqual([{seat:1,reason:'participant_missing'}]);
});
it('clears a missing deck without choosing another deck or dropping its owner',()=>{
 const result=reconcileLiveGameReferences([{participantKey:'user:alice',deckId:'old-deck'}],catalog,{allowArchived:true});
 expect(result.seats).toEqual([{participantKey:'user:alice',deckId:null}]);expect(result.resolved).toEqual([]);
});
it('does not accept another participant deck with the same reference',()=>{
 expect(reconcileLiveGameReferences([{participantKey:'user:alice',deckId:'deck-b'}],catalog,{allowArchived:true}).issues)
  .toEqual([{seat:0,reason:'deck_missing'}]);
});
it('keeps the first occurrence and clears duplicate participants',()=>{
 expect(reconcileLiveGameReferences([seats[0],seats[0]],catalog,{allowArchived:true}).seats)
  .toEqual([seats[0],{participantKey:null,deckId:null}]);
});
it.each([null,''])('requires an explicit available deck choice: %s',deckId=>{
 expect(reconcileLiveGameReferences([{participantKey:'user:alice',deckId}],catalog,{allowArchived:true}).issues)
  .toEqual([{seat:0,reason:'deck_missing'}]);
});
it('lets the caller preserve ordinary arena archive policy or require active preset references',()=>{
 const archived=[{...catalog[0],decks:[{...catalog[0].decks[0],isArchived:true}]}];
 expect(reconcileLiveGameReferences([seats[0]],archived,{allowArchived:true}).issues).toEqual([]);
 expect(reconcileLiveGameReferences([seats[0]],archived,{allowArchived:false}).issues).toEqual([{seat:0,reason:'deck_archived'}]);
});
it('availability stamps ignore unrelated decks and metadata but track selected references',()=>{
 const baseline=liveGameReferenceStamp(seats,catalog);
 expect(liveGameReferenceStamp(seats,[...catalog,{key:'user:other',displayName:'Other',decks:[]}])).toBe(baseline);
 expect(liveGameReferenceStamp(seats,catalog.map(value=>({...value,displayName:'Renamed'})))).toBe(baseline);
 expect(liveGameReferenceStamp(seats,[{...catalog[0],decks:[]},catalog[1]])).not.toBe(baseline);
});
