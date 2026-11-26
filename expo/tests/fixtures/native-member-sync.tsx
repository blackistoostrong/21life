import React,{useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useLiveGameCommandScope} from '../../hooks/use-live-game-command-scope';
import {useLiveSetupMemberSync} from '../../hooks/use-live-setup-member-sync';
import type {ApiRequestOptions} from '../../lib/api';
const calls:Array<{body:unknown;options:ApiRequestOptions;reply:(value:unknown)=>void}>=[];
const refreshes:Array<{reply:(limited:boolean)=>void;fail:()=>void}>=[];
const members=[{id:'target',archidekt_auto_import:true}];
let current:ReturnType<typeof useLiveSetupMemberSync>;
const refreshMemberDecks=()=>new Promise<boolean>((reply,reject)=>refreshes.push({reply,fail:()=>reject(Error('offline'))}));
function Owner({actor,group,token}:{actor:string;group:string;token:string}){
 const scope=useLiveGameCommandScope(actor,group,{user:{id:actor},access_token:token});
 const owner=useLiveSetupMemberSync({groupId:group,currentUserId:actor,members,refreshMemberDecks,copy:key=>key,language:'en',scope});
 useLayoutEffect(()=>{current=owner;},[owner]);
 return <output data-testid="member-sync">{JSON.stringify({actor,state:owner.archidektSyncRequest})}</output>;
}
const root=createRoot(document.getElementById('root')!);
Object.assign(window,{memberSyncPort:{post:(_path:string,body:unknown,options:ApiRequestOptions)=>new Promise(reply=>calls.push({body,options,reply}))},
 memberSyncHarness:{
  render:(actor='a',group='g',token='token-a')=>flushSync(()=>root.render(<Owner actor={actor} group={group} token={token}/>)),
  select:(key='user:target')=>current.handleSelectSetupParticipant(key as 'user:target'),
  retry:()=>current.handleRetryArchidektSync('user:target'),
  calls:()=>calls.map(({body,options})=>({body,bearer:options.headers?.Authorization,aborted:options.signal?.aborted??false})),
  refreshes:()=>refreshes.length,
  reply:(index:number,skipped=0)=>calls[index].reply({status:200,requestId:'123e4567-e89b-42d3-a456-426614174000',data:{inserted:1,updated:0,unchanged:0,skipped}}),
  refresh:(index:number,outcome:'ok'|'error')=>outcome==='ok'?refreshes[index].reply(false):refreshes[index].fail(),
  unmount:()=>flushSync(()=>root.unmount()),
 }});
