import React, {useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useLiveGameCommandScope} from '../../../expo/hooks/use-live-game-command-scope';
import {useNativeLiveSetup} from '../../../expo/hooks/use-native-live-setup';
const reads:Array<{key:string;reply:(value:string|null)=>void}>=[];
let current:ReturnType<typeof useNativeLiveSetup>;
const empty:never[]=[];
const members=[{id:'a',username:'Alice',display_name:null},{id:'b',username:'Bob',display_name:null}];
function Owner({actor,group,token}:{actor:string;group:string;token:string}){
  const scope=useLiveGameCommandScope(actor,group,{user:{id:actor},access_token:token});
  const setup=useNativeLiveSetup(group,{id:actor},{members,guests:empty,decks:empty,matches:empty,loading:false},scope);
  useLayoutEffect(()=>{current=setup;},[setup]);
  return <output data-testid="setup-state">{JSON.stringify({ready:setup.setupReadyKey,life:setup.startingLife,error:setup.setupRestoreError,
    selected:setup.selectedKeys,actorDecks:setup.getDeckOptions('user:a').map(deck=>deck.id)})}</output>;
}
const root=createRoot(document.getElementById('root')!);
Object.assign(window,{nativeSetupStorage:{getItem:(key:string)=>new Promise<string|null>(reply=>reads.push({key,reply}))},
  nativeSetupHarness:{
    render:(actor='a',group='g',token='token-a')=>flushSync(()=>root.render(<Owner actor={actor} group={group} token={token}/>)),
    reads:()=>reads.map(item=>item.key),
    reply:(index:number,life:number|null,deck?:string)=>reads[index].reply(life===null?null:JSON.stringify({playerCount:2,
      startingLife:life,layoutVariant:'classic',seats:[{participantKey:'user:a',deckId:deck??null},{participantKey:null,deckId:null}]})),
    retry:()=>current.setSetupRetry(value=>value+1),
    unmount:()=>flushSync(()=>root.unmount()),
  }});
