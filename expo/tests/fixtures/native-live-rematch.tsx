import React,{StrictMode,useLayoutEffect,useMemo,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useNativeLiveRematch} from '../../hooks/use-native-live-rematch';
import {useLiveGameCommandScope} from '../../hooks/use-live-game-command-scope';
import {createNativeLiveSessionJournal} from '../../lib/native-live-session-journal';
import {createLiveGameRound} from '../../lib/live-game-round';
import type {LiveGameRecord} from '../../lib/live-game';
import type {ParticipantKey} from '../../lib/participant-keys';
import type {LiveGameSeatReference} from '../../../packages/domain/live-game-reference-validation';
let root:Root|null=null;let current:ReturnType<typeof useNativeLiveRematch>;
let currentJournal:ReturnType<typeof createNativeLiveSessionJournal>;let close:()=>void;let journalWrites=0;let syncs=0;
let holdSave=false;let releaseSave:()=>void=()=>{};
const previous=createLiveGameRound({id:'previous',groupId:'group',actorId:'alice',startedAt:'2026-11-27T00:00:00Z',
 startingLife:40,layoutVariant:'classic',random:()=>0,seats:[
 {participantKey:'user:alice',deckId:'deck-a',displayName:'Alice before',commander:'A before',commanderImage:null},
 {participantKey:'guest:bob',deckId:'deck-b',displayName:'Bob before',commander:'B before',commanderImage:null}]});
const members=[{id:'alice',username:'alice',display_name:'Alice'}];
const guests=[{id:'bob',group_id:'group',display_name:'Bob',last_played_at:null,created_at:'2026-11-27T00:00:00Z'}];
function Owner({actor,online}:{actor:string;online:boolean}){
 const scope=useLiveGameCommandScope(actor,'group',{user:{id:actor},access_token:'fixture-token'});
 const journal=useMemo(()=>createNativeLiveSessionJournal('group',actor,{isCurrent:scope.isCurrent,randomUUID:()=>crypto.randomUUID()}),[actor,scope.isCurrent]);
 useLayoutEffect(()=>{journal.activate();return()=>journal.deactivate();},[journal]);
 const [recap,setRecap]=useState<LiveGameRecord|null>(previous);const [open,setOpen]=useState(true);
 const [seats,setSeats]=useState<LiveGameSeatReference[]>([]);
 const rematch=useNativeLiveRematch({groupId:'group',user:{id:actor},completedGame:recap,rematchOpen:open,scope,
  catalog:{members,guests},setup:{getDeckOptions:(key:ParticipantKey)=>[{id:key==='user:alice'?'deck-a':'deck-b',name:'Deck',commander:'Old',commander_image:null,bracket:null}],
   setPlayerCount:()=>{},setLayoutVariant:()=>{},applySeatSetups:setSeats,applyStartingLife:()=>{}},
  session:{journal,networkOnline:online,saveJournal:async()=>{journalWrites++;if(holdSave)await new Promise<void>(resolve=>{releaseSave=resolve;});},syncJournal:async()=>{syncs++;}},
  presentation:{onEvent:()=>{setOpen(false);setRecap(null);},revealStartingPlayer:()=>{}}});
 useLayoutEffect(()=>{current=rematch;currentJournal=journal;close=()=>setOpen(false);},[rematch,journal]);
 return <output data-testid="rematch-state">{JSON.stringify({actor,open,starting:rematch.starting,seats})}</output>;
}
Object.assign(window,{rematchHarness:{
 render:(actor='alice',online=true)=>{root??=createRoot(document.getElementById('root')!);flushSync(()=>root!.render(<StrictMode><Owner actor={actor} online={online}/></StrictMode>));},
 start:()=>{void current.handleRematchSameDecks();},close:()=>flushSync(()=>close()),
 hold:()=>{holdSave=true;},release:()=>releaseSave(),
 stats:()=>({writes:journalWrites,syncs,record:currentJournal.getSnapshot().record}),
 unmount:()=>flushSync(()=>{root?.unmount();root=null;}),
}});
