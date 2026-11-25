import React, { useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLiveGameCommandScope } from '../../../expo/hooks/use-live-game-command-scope';

type Scope=ReturnType<typeof useLiveGameCommandScope>;
let current:Scope;
let root:Root|null=null;
const captures:Array<{active:()=>boolean;bound:ReturnType<Scope['bindClient']>;epoch:Scope['epoch']}>=[];
function Owner({actor,group,token}:{actor:string;group:string;token:string}) {
  const scope=useLiveGameCommandScope(actor,group,{user:{id:actor},access_token:token});
  useLayoutEffect(()=>{current=scope;},[scope]);
  return <span data-testid="scope-owner">{actor}:{group}:{token}</span>;
}
Object.assign(window,{liveScopeHarness:{
  render:(actor='a',group='g1',token='token-a')=>{
    root??=createRoot(document.getElementById('root')!);
    root.render(<Owner actor={actor} group={group} token={token}/>);
  },
  capture:()=>{captures.push({active:current.isCurrent,bound:current.bindClient(),epoch:current.epoch});return captures.length-1;},
  active:(index:number)=>captures[index].active(),
  sameEpoch:(index:number)=>captures[index].epoch===current.epoch,
  send:async(index:number)=>{const result=await captures[index].bound.client.rpc('scope_probe',{});if(result.error)throw Error('Fixture RPC failed');},
  unmount:()=>{root?.unmount();root=null;},
}});
