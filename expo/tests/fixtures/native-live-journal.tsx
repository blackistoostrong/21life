import React,{StrictMode,useLayoutEffect} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useLiveGameCommandScope} from '../../hooks/use-live-game-command-scope';
import {useNativeLiveJournal} from '../../hooks/use-native-live-journal';
import {useLiveGameRuntimeStore} from '../../stores/live-game-runtime-store';
import {createLiveGameRound} from '../../lib/live-game-round';
import type {NativeLiveSessionJournal} from '../../lib/native-live-session-journal';
import {NavigationContext,navigation} from './native-live-journal-ports';

type Entry={slot:string;actor:string;group:string;token:string};
let root:Root|null=null;
const navs={a:navigation(true),b:navigation(false)};
const current=new Map<string,NativeLiveSessionJournal>();
const captures:NativeLiveSessionJournal[]=[];
function Owner({slot,actor,group,token}:Entry){
  const scope=useLiveGameCommandScope(actor,group,{user:{id:actor},access_token:token});
  const {journal,snapshot}=useNativeLiveJournal(group,actor,scope);
  useLayoutEffect(()=>{current.set(slot,journal);},[slot,journal]);
  return <output data-testid={`native-journal-${slot}`}>{actor}:{group}:{snapshot.record?.id??'empty'}:{snapshot.record?.state.players[0].life??'-'}:{token}</output>;
}
function Projection(){
  const players=useLiveGameRuntimeStore(value=>value.playersByKey);
  return <output data-testid="native-journal-projection">{Object.values(players).map(player=>`${player!.participantKey}:${player!.life}`).join('|')}</output>;
}
Object.assign(window,{nativeJournalHarness:{
  render:(actor='alice',group='g1',token='token-a',pair=false)=>{
    root??=createRoot(document.getElementById('root')!);
    const entries:Entry[]=[{slot:'a',actor,group,token},...(pair?[{slot:'b',actor,group:'g2',token}]:[])];
    flushSync(()=>root!.render(<StrictMode>{entries.map(entry=><NavigationContext.Provider key={entry.slot} value={navs[entry.slot as 'a'|'b']}><Owner {...entry}/></NavigationContext.Provider>)}<Projection/></StrictMode>));
  },
  start:async(slot='a',life=40)=>{
    const journal=current.get(slot)!;
    const actor=slot==='b'?'alice':journal.view.getState().record?.created_by??'alice';
    // Read current scope labels from the rendered fixture, not production globals.
    const [labelActor,group]=document.querySelector(`[data-testid="native-journal-${slot}"]`)!.textContent!.split(':');
    journal.start(createLiveGameRound({id:`game-${slot}-${group}`,groupId:group,actorId:labelActor??actor,startedAt:'2026-11-26T00:00:00Z',
      startingLife:life,layoutVariant:'classic',random:()=>0,seats:[{participantKey:`user:${labelActor}`,deckId:'deck',displayName:labelActor,commander:'A',commanderImage:null},
        {participantKey:'guest:g',deckId:'guest-deck',displayName:'Guest',commander:'B',commanderImage:null}]}));
    await journal.persist();
  },
  adjust:async(slot='a',amount=1)=>{
    const journal=current.get(slot)!;const key=journal.getSnapshot().record!.state.players[0].participantKey;
    await journal.enqueue({type:'adjust',targetKey:key,amount,mode:'life'});
  },
  capture:(slot='a')=>captures.push(current.get(slot)!)-1,
  same:(index:number,slot='a')=>captures[index]===current.get(slot),
  restore:async(slot='a')=>{const journal=current.get(slot)!;const saved=await journal.loadSaved();if(saved)journal.restore(saved);},
  lateClose:(index:number)=>captures[index].closeRemote(),
  focus:(slot:'a'|'b',value:boolean)=>navs[slot].focus(value),
  listeners:(slot:'a'|'b')=>navs[slot].count(),
  unmount:()=>{root?.unmount();root=null;},
}});
