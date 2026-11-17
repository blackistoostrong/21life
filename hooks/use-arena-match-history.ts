'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {fetchArenaHistoryPage} from '@/lib/arena-history-query';
import {arenaHistoryScope,type ArenaHistoryCursor,type ArenaHistoryMatch,type ArenaHistoryPage} from '@/packages/domain/arena-history';

type Position={cursor:ArenaHistoryCursor|null;previous:Array<ArenaHistoryCursor|null>;index:number};
type Snapshot={key:string;page:ArenaHistoryPage;position:Position;recentMatches:ArenaHistoryMatch[]};
type Target={key:string;position:Position;revision:string|null};
type State={status:'idle'}|{status:'loading';key:string;previous:Snapshot|null}
  |{status:'ready';data:Snapshot}|{status:'error';key:string;previous:Snapshot|null;code:string};
const empty:ArenaHistoryMatch[]=[];
const firstPosition=():Position=>({cursor:null,previous:[],index:0});
function errorCode(error:unknown) {
  return error instanceof Error && error.message.startsWith('ARENA_HISTORY_')?error.message:'ARENA_HISTORY_UNAVAILABLE';
}

/** Owns one bounded page and its cursor history; no aggregate is inferred from visible rows. */
export function useArenaMatchHistory(userId:string|undefined,groupId:string,since:string|null=null,until:string|null=null) {
  const scope=useMemo(()=>{
    if(!userId || !groupId)return null;
    try{return arenaHistoryScope(groupId,{since,until});}catch{return null;}
  },[userId,groupId,since,until]);
  const key=scope?JSON.stringify([userId,scope,'v2']):null;
  const [state,setState]=useState<State>({status:'idle'});
  const epoch=useRef(0);
  const context=useRef<string|null>(null);
  const request=useRef<AbortController|null>(null);
  const latest=useRef<Snapshot|null>(null);
  const lastTarget=useRef<Target|null>(null);

  const read=useCallback(async(position:Position,revision:string|null):Promise<ArenaHistoryPage|null>=>{
    // A late mutation callback from the previous route/account must not abort
    // or replace the new context's request.
    if(!key || !scope || context.current!==key)return null;
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    const generation=++epoch.current;
    const previous=latest.current?.key===key?latest.current:null;
    lastTarget.current={key,position,revision};
    setState({status:'loading',key,previous});
    try {
      const page=await fetchArenaHistoryPage(supabase,scope,position.cursor,revision,controller.signal);
      if(controller.signal.aborted || generation!==epoch.current)return null;
      const offset=position.index*scope.limit;
      if(offset+page.matches.length>page.total || (position.index>0 && page.matches.length===0))throw new Error('ARENA_HISTORY_CONTRACT_INVALID');
      const data={key,page,position,recentMatches:position.index===0?page.matches.slice(0,3):previous?.recentMatches??[]};latest.current=data;
      setState({status:'ready',data});
      return page;
    } catch(error) {
      if(controller.signal.aborted || generation!==epoch.current)return null;
      setState({status:'error',key,previous,code:errorCode(error)});
      return null;
    } finally {if(request.current===controller)request.current=null;}
  },[key,scope]);
  const reload=useCallback(()=>read(firstPosition(),null),[read]);
  useEffect(()=>{
    context.current=key;
    latest.current=null;lastTarget.current=null;
    void reload();
    return()=>{context.current=null;request.current?.abort();request.current=null;latest.current=null;lastTarget.current=null;};
  },[key,reload]);
  const next=useCallback(()=>{
    const current=latest.current;
    if(!current || current.key!==key || !current.page.next || request.current)return;
    return read({cursor:current.page.next,previous:[...current.position.previous,current.position.cursor],index:current.position.index+1},current.page.revision);
  },[key,read]);
  const previous=useCallback(()=>{
    const current=latest.current;
    if(!current || current.key!==key || !current.position.previous.length || request.current)return;
    const stack=[...current.position.previous],cursor=stack.pop()!;
    return read({cursor,previous:stack,index:current.position.index-1},current.page.revision);
  },[key,read]);
  const failed=state.status==='error' && state.key===key?state:null;
  const retry=useCallback(()=>{
    const target=lastTarget.current;
    if(failed?.code==='ARENA_HISTORY_CHANGED' || !target || target.key!==key)return reload();
    return read(target.position,target.revision);
  },[failed?.code,key,read,reload]);
  const snapshot=state.status==='ready'?state.data:state.status==='idle'?null:state.previous;
  const current=snapshot?.key===key?snapshot:null;
  const loading=Boolean(scope) && (state.status==='idle' || (state.status!=='ready' && state.key!==key) || state.status==='loading');
  const count=current?.page.matches.length??0;
  const offset=(current?.position.index??0)*(scope?.limit??100);
  return {scope,recentMatches:current?.recentMatches??empty,matches:current?.page.matches??empty,total:current?.page.total??null,loading,error:failed?.code??null,
    canGoNext:current?.page.next!=null,canGoPrevious:Boolean(current?.position.previous.length),
    from:count?offset+1:0,to:offset+count,pageIndex:current?.position.index??0,
    reload,retry,next,previous};
}
