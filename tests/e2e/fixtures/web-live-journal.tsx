import React,{StrictMode,useLayoutEffect} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {useWebLiveJournal} from '@/hooks/use-web-live-journal';
import {createLiveGameRound} from '@/lib/live-game-round';
import type {WebLiveSessionJournal} from '@/lib/web-live-session-journal';

let root:Root|null=null;
let current:WebLiveSessionJournal;
const owners:WebLiveSessionJournal[]=[];
function Owner({actor,group}:{actor:string;group:string}){
  const {journal,snapshot}=useWebLiveJournal(group,actor);
  useLayoutEffect(()=>{current=journal;},[journal]);
  return <span data-testid="journal-view">{actor}:{group}:{snapshot.record?.id??'empty'}:{snapshot.record?.state.players[0]?.life??'-'}</span>;
}
Object.assign(window,{webJournalHarness:{
  render:(actor='alice',group='g1')=>{
    root??=createRoot(document.getElementById('root')!);
    root.render(<StrictMode><Owner actor={actor} group={group}/></StrictMode>);
  },
  capture:()=>owners.push(current)-1,
  start:(actor='alice',group='g1')=>{
    current.start(createLiveGameRound({id:`game-${actor}-${group}`,groupId:group,actorId:actor,
      startedAt:'2026-11-26T00:00:00Z',startingLife:40,layoutVariant:'classic',random:()=>0,
      seats:[{participantKey:`user:${actor}`,deckId:'deck-a',displayName:actor,commander:'A',commanderImage:null},
        {participantKey:'guest:guest',deckId:'deck-b',displayName:'Guest',commander:'B',commanderImage:null}],
    }));current.persist();
  },
  restore:()=>{const saved=current.readSaved();if(saved.journal)current.restore(saved.journal);},
  lateFinish:(index:number)=>owners[index].finish(owners[index].getSnapshot().record?.id??'missing'),
  lateEnqueue:(index:number)=>owners[index].enqueue({type:'adjust',targetKey:'user:alice',amount:5,mode:'life'}),
  adjust:()=>current.enqueue({type:'adjust',targetKey:'user:alice',amount:1,mode:'life'},
    {type:'adjust',targetKey:'user:alice',amount:-1,mode:'life'}),
  undo:()=>current.undo(),redo:()=>current.redo(),
  unmount:()=>{root?.unmount();root=null;},
}});
