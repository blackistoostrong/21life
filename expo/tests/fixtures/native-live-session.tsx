import React,{StrictMode,useCallback,useLayoutEffect,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useNativeLiveSession} from '../../hooks/use-native-live-session';
import {useLiveGameCommandScope} from '../../hooks/use-live-game-command-scope';
import {createLiveGameRound} from '../../lib/live-game-round';
import {NavigationContext,navigation} from './native-live-journal-ports';
import {probe} from './native-live-session-ports';
import type {LiveGameRecord} from '../../lib/live-game';

let root:Root|null=null;let current:ReturnType<typeof useNativeLiveSession>;let labels={actor:'alice',group:'g1'};
const nav=navigation(true);const captures:unknown[]=[];
function Owner({actor,group,token}:{actor:string;group:string;token:string}){
 const scope=useLiveGameCommandScope(actor,group,{user:{id:actor},access_token:token});
 const [recap,setRecap]=useState<LiveGameRecord|null>(null);const [,setRetry]=useState(0);
 const onRemoteCompleted=useCallback((record:LiveGameRecord)=>{setRecap(record);},[]);
 const session=useNativeLiveSession({groupId:group,currentUserId:actor,scope,hasCompletedGame:Boolean(recap),setSetupRetry:setRetry,onRemoteCompleted});
 useLayoutEffect(()=>{current=session;labels={actor,group};},[session,actor,group]);
 useLayoutEffect(()=>{setRecap(null);},[scope.epoch]);
 return <output data-testid="native-session">{actor}:{group}:{session.booting?'boot':'ready'}:{session.liveGame?.id??'empty'}:{session.syncStatus}:{recap?.id??'-'}</output>;
}
Object.assign(window,{nativeSessionHarness:{
 render:(actor='alice',group='g1',token='token-a')=>{
  root??=createRoot(document.getElementById('root')!);
  flushSync(()=>root!.render(<StrictMode><NavigationContext.Provider value={nav}><Owner actor={actor} group={group} token={token}/></NavigationContext.Provider></StrictMode>));
 },
 stats:probe.stats,hold:probe.hold,release:probe.release,lateStatus:probe.lateStatus,
 start:async()=>{
  current.journal.start(createLiveGameRound({id:`game-${labels.actor}-${labels.group}`,groupId:labels.group,actorId:labels.actor,startedAt:'2026-11-26T00:00:00Z',
   startingLife:40,layoutVariant:'classic',random:()=>0,seats:[{participantKey:`user:${labels.actor}`,deckId:'deck',displayName:labels.actor,commander:'A',commanderImage:null},
   {participantKey:'guest:g',deckId:'guest',displayName:'Guest',commander:'B',commanderImage:null}]}));
  await current.saveJournal();await current.syncJournal();
 },
 startPending:()=>{void (window as unknown as {nativeSessionHarness:{start:()=>Promise<void>}}).nativeSessionHarness.start();},
 adjust:()=>{current.enqueueMutation({type:'adjust',targetKey:`user:${labels.actor}`,amount:1,mode:'life'});},
 end:()=>probe.end(current.liveGame!),capture:()=>captures.push(current.journal)-1,same:(index:number)=>captures[index]===current.journal,
 unmount:()=>{root?.unmount();root=null;},
}});
