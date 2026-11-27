import type {ParticipantKey} from './participant-keys';
import type {LiveGameRoundSeat} from './live-game-round';

export type LiveGameSeatReference={participantKey:ParticipantKey|null;deckId:string|null};
export type LiveGameReferenceParticipant={
  key:ParticipantKey;displayName:string;
  decks:readonly {id:string;commander:string;commanderImage:string|null;isArchived?:boolean;name?:string;sourceType?:string|null;bracket?:string|null}[];
};
export type LiveGameReferenceIssue={seat:number;reason:'participant_missing'|'participant_duplicate'|'deck_missing'|'deck_archived'};

/** Reconcile references without selecting another participant or deck. */
export function reconcileLiveGameReferences(
  seats:readonly LiveGameSeatReference[],participants:readonly LiveGameReferenceParticipant[],
  options:{allowArchived:boolean},
){
  const issues:LiveGameReferenceIssue[]=[];const seen=new Set<ParticipantKey>();
  const resolved:LiveGameRoundSeat[]=[];
  const next=seats.map((seat,index):LiveGameSeatReference=>{
    const participant=participants.find(value=>value.key===seat.participantKey);
    if(!participant){issues.push({seat:index,reason:'participant_missing'});return{participantKey:null,deckId:null};}
    if(seen.has(participant.key)){issues.push({seat:index,reason:'participant_duplicate'});return{participantKey:null,deckId:null};}
    seen.add(participant.key);
    const deck=participant.decks.find(value=>value.id===seat.deckId);
    if(!deck||(!options.allowArchived&&deck.isArchived)){
      issues.push({seat:index,reason:deck?'deck_archived':'deck_missing'});
      return{participantKey:participant.key,deckId:null};
    }
    resolved.push({participantKey:participant.key,deckId:deck.id,displayName:participant.displayName,
      commander:deck.commander,commanderImage:deck.commanderImage});
    return{participantKey:participant.key,deckId:deck.id};
  });
  return {seats:next,resolved,issues};
}

/** Watch only the requested references, not unrelated catalog changes or card art. */
export function liveGameReferenceStamp(seats:readonly LiveGameSeatReference[],
  participants:readonly {key:ParticipantKey;decks:readonly {id:string;isArchived?:boolean}[]}[]){
  return JSON.stringify(seats.map(seat=>{
    const participant=participants.find(value=>value.key===seat.participantKey);
    const deck=participant?.decks.find(value=>value.id===seat.deckId);
    return[seat.participantKey,seat.deckId,Boolean(participant),Boolean(deck),Boolean(deck?.isArchived)];
  }));
}
