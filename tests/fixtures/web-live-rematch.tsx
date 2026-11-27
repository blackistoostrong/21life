import React,{StrictMode,useLayoutEffect,useMemo,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useWebLiveRoundCommands} from '../../hooks/use-web-live-round-commands';
import {useCommandScope} from '../../hooks/use-command-scope';
import {createWebLiveSessionJournal} from '../../lib/web-live-session-journal';
import {createLiveGameRound} from '../../lib/live-game-round';
import type {LiveGameRecord} from '../../lib/live-game';
import type {WebLiveGameSeatSetup} from '../../lib/live-game-setup';
let root:Root|null=null;let start:()=>void;let currentJournal:ReturnType<typeof createWebLiveSessionJournal>;
let close:()=>void;let journalWrites=0;let syncs=0;
const previous=createLiveGameRound({id:'previous',groupId:'group',actorId:'alice',startedAt:'2026-11-27T00:00:00Z',
 startingLife:40,layoutVariant:'classic',random:()=>0,seats:[
 {participantKey:'user:alice',deckId:'deck-a',displayName:'Alice before',commander:'A before',commanderImage:null},
 {participantKey:'guest:bob',deckId:'deck-b',displayName:'Bob before',commander:'B before',commanderImage:null}]});
const previousSetup={playerCount:2,startingLife:40,layoutVariant:'classic' as const,
 seats:previous.state.players.map(player=>({participantKey:player.participantKey,deckId:player.deckId}))};
const participants=previous.state.players.map(player=>({key:player.participantKey,displayName:player.displayName,
 isGuest:player.participantKey.startsWith('guest:'),userId:null,guestId:null,
 decks:[{id:player.deckId,name:'Deck',commander:player.commander,commanderImage:null,isFavorite:false}]}));
function Owner({actor}:{actor:string}){
 const scope=useCommandScope<'command'>(actor+':group',true);
 const journal=useMemo(()=>createWebLiveSessionJournal('group',actor),[actor]);
 useLayoutEffect(()=>{journal.activate();return()=>journal.deactivate();},[journal]);
 const [recap,setRecap]=useState<LiveGameRecord|null>(previous);
 const [seats,setSeats]=useState<WebLiveGameSeatSetup[]>(previousSetup.seats);
 const commands=useWebLiveRoundCommands('group',actor,{completedRecord:recap,
  setup:{participants,occasionalCreationBusy:false,...previousSetup,seats,persistSetup:()=>{}},
  session:{journal:{...journal,persist:()=>{journalWrites++;journal.persist();}},record:null,
   flush:async()=>{syncs++;return true;},beginRoundCommand:()=>scope.begin('command')},
  selection:{isDraw:true,winnerKey:'',winCondition:null,duration:'0'},enqueue:()=>{},
  presentation:{enterTrackerLandscape:()=>{},restoreDefaultTrackerDisplay:()=>{},runRoulette:()=>{},
   onRoundCreated:()=>setRecap(null),onSetupRequired:next=>{setSeats(next.seats);setRecap(null);}}});
 useLayoutEffect(()=>{start=()=>{void commands.startGame(previousSetup,previous);};currentJournal=journal;close=()=>setRecap(null);},[commands,journal]);
 return <output data-testid="rematch-state">{JSON.stringify({actor,open:Boolean(recap),starting:commands.starting,seats})}</output>;
}
Object.assign(window,{rematchHarness:{
 render:(actor='alice',online=true)=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:online});
  root??=createRoot(document.getElementById('root')!);flushSync(()=>root!.render(<StrictMode><Owner actor={actor}/></StrictMode>));},
 start:()=>start(),close:()=>flushSync(()=>close()),hold:()=>{},release:()=>{},
 stats:()=>({writes:journalWrites,syncs,record:currentJournal.getSnapshot().record}),
 unmount:()=>flushSync(()=>{root?.unmount();root=null;}),
}});
