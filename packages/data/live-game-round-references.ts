import {parseParticipantKey} from '../domain/participant-keys';
import type {LiveGameReferenceParticipant,LiveGameSeatReference} from '../domain/live-game-reference-validation';
import {withRequestDeadline} from './request-deadline';

type Reply={data:unknown;error:unknown};
export const LIVE_GAME_REFERENCE_COLUMNS={
  group:'id,group_members(user_id,profiles(id,username,display_name))',
  deck:'id,user_id,group_id,commander,commander_image,is_archived,source_type',
  guest:'id,group_id,display_name',
  guestDeck:'id,guest_id,group_id,commander,commander_image',
} as const;
export interface LiveGameReferenceReader{
  group(groupId:string,userIds:string[],signal:AbortSignal):PromiseLike<Reply>;
  decks(ids:string[],signal:AbortSignal):PromiseLike<Reply>;
  guests(groupId:string,ids:string[],signal:AbortSignal):PromiseLike<Reply>;
  guestDecks(groupId:string,ids:string[],signal:AbortSignal):PromiseLike<Reply>;
}
export class LiveGameReferenceReadError extends Error{
  constructor(readonly kind:'unavailable'|'invalid'){super(`LIVE_GAME_REFERENCES_${kind.toUpperCase()}`);}
}
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new LiveGameReferenceReadError('invalid');
  return value as Record<string,unknown>;
}
function rows(value:unknown){
  if(!Array.isArray(value))throw new LiveGameReferenceReadError('invalid');
  return value.map(object);
}
function text(value:unknown){
  if(typeof value!=='string'||!value)throw new LiveGameReferenceReadError('invalid');
  return value;
}
function label(value:unknown){
  if(typeof value!=='string')throw new LiveGameReferenceReadError('invalid');
  return value;
}
function image(value:unknown){return value===null||value===''?null:text(value);}

/** Bounded reference reads; no catalog cache, service role or global client. */
export async function readLiveGameRoundReferences(reader:LiveGameReferenceReader,input:{
  groupId:string;actorId:string;seats:readonly LiveGameSeatReference[];
},parentSignal?:AbortSignal):Promise<{kind:'denied'}|{kind:'ready';participants:LiveGameReferenceParticipant[]}>{
  if(input.seats.length>6)throw new LiveGameReferenceReadError('invalid');
  const controller=new AbortController();const abort=()=>controller.abort();
  const budget=setTimeout(abort,15000);
  parentSignal?.addEventListener('abort',abort,{once:true});
  const refs=input.seats.map(seat=>({seat,owner:seat.participantKey?parseParticipantKey(seat.participantKey):null}));
  const users=Array.from(new Set([input.actorId,...refs.flatMap(({owner})=>owner?.type==='user'?[owner.id]:[])]));
  const guests=Array.from(new Set(refs.flatMap(({owner})=>owner?.type==='guest'?[owner.id]:[])));
  const userDecks=Array.from(new Set(refs.flatMap(({seat,owner})=>owner?.type==='user'&&seat.deckId?[seat.deckId]:[])));
  const guestDecks=Array.from(new Set(refs.flatMap(({seat,owner})=>owner?.type==='guest'&&seat.deckId?[seat.deckId]:[])));
  const read=async(create:(signal:AbortSignal)=>PromiseLike<Reply>)=>{
    let reply:Reply;
    try{reply=await withRequestDeadline({abortSignal:create},15000,controller.signal);}
    catch{throw new LiveGameReferenceReadError('unavailable');}
    if(reply.error)throw new LiveGameReferenceReadError('unavailable');
    return reply.data;
  };
  try{
    // React Native signals need not expose the newer throwIfAborted method.
    if(parentSignal?.aborted)controller.abort();
    const groupData=await read(signal=>reader.group(input.groupId,users,signal));
    if(groupData===null)return{kind:'denied'};
    const group=object(groupData);
    if(text(group.id)!==input.groupId)throw new LiveGameReferenceReadError('invalid');
    const members=rows(group.group_members);
    if(!members.some(member=>member.user_id===input.actorId))return{kind:'denied'};
    const [deckData,guestData,guestDeckData]=await Promise.all([
      userDecks.length?read(signal=>reader.decks(userDecks,signal)):[],
      guests.length?read(signal=>reader.guests(input.groupId,guests,signal)):[],
      guestDecks.length?read(signal=>reader.guestDecks(input.groupId,guestDecks,signal)):[],
    ]);
    const decks=rows(deckData),guestRows=rows(guestData),guestDeckRows=rows(guestDeckData);
    const participants:LiveGameReferenceParticipant[]=members.filter(member=>member.profiles!==null).map(member=>{
      const profile=object(member.profiles),id=text(member.user_id);
      if(text(profile.id)!==id||!users.includes(id))throw new LiveGameReferenceReadError('invalid');
      return{key:`user:${id}`,displayName:typeof profile.display_name==='string'&&profile.display_name.trim()
        ?profile.display_name.trim():text(profile.username),decks:decks.filter(deck=>deck.user_id===id
          &&(deck.group_id===null||deck.group_id===input.groupId)&&deck.source_type!=='historical').map(deck=>{
        if(!userDecks.includes(text(deck.id))||typeof deck.is_archived!=='boolean'
          ||(deck.source_type!==null&&typeof deck.source_type!=='string'))throw new LiveGameReferenceReadError('invalid');
        return{id:text(deck.id),commander:label(deck.commander),commanderImage:image(deck.commander_image),isArchived:deck.is_archived};
      })};
    });
    for(const guest of guestRows){
      const id=text(guest.id);
      if(guest.group_id!==input.groupId||!guests.includes(id))throw new LiveGameReferenceReadError('invalid');
      participants.push({key:`guest:${id}`,displayName:text(guest.display_name),decks:guestDeckRows
        .filter(deck=>deck.guest_id===id&&deck.group_id===input.groupId).map(deck=>{
          if(!guestDecks.includes(text(deck.id)))throw new LiveGameReferenceReadError('invalid');
          return{id:text(deck.id),commander:label(deck.commander),commanderImage:image(deck.commander_image)};
        })});
    }
    return{kind:'ready',participants};
  }finally{
    clearTimeout(budget);controller.abort();parentSignal?.removeEventListener('abort',abort);
  }
}
