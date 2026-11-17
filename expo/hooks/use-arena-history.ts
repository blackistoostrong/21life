import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {fetchArenaHistoryPage} from '@/lib/arena-history-query';
import {arenaHistoryScope,type ArenaHistoryCursor} from '../../packages/domain/arena-history';
import type {ArenaMatch} from '@/lib/types/arena';

type Snapshot={key:string;matches:ArenaMatch[];total:number|null;revision:string|null;next:ArenaHistoryCursor|null};
type State={key:string;status:'cached'|'ready';data:Snapshot}|{key:string;status:'loading'|'more'|'error';data:Snapshot|null;error?:string};
const empty:ArenaMatch[]=[];
/** Explicit native page accumulation. Cache never supplies totals or a usable cursor. */
export function useArenaHistory(groupId:string|undefined,userId:string|undefined) {
  const scope=useMemo(()=>{try{return groupId && userId?arenaHistoryScope(groupId):null;}catch{return null;}},[groupId,userId]);
  const key=scope?`${userId}:${groupId}:history-v2`:null;
  const [state,setState]=useState<State|null>(null);
  const context=useRef<string|null>(null),request=useRef<AbortController|null>(null);
  const latest=useRef<Snapshot|null>(null);
  const read=useCallback(async(append=false):Promise<ArenaMatch[]|null>=>{
    if(!key || !scope || context.current!==key)return null;
    const previous=latest.current?.key===key?latest.current:null;
    if(append && (!previous?.next || request.current))return null;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setState({key,status:append?'more':'loading',data:previous});
    try {
      const page=await fetchArenaHistoryPage(supabase,scope,append?previous!.next:null,append?previous!.revision:null,controller.signal);
      if(controller.signal.aborted || request.current!==controller || context.current!==key)return null;
      const rows=page.matches as unknown as ArenaMatch[];
      const matches=append?[...previous!.matches,...rows]:rows;
      if((append && previous!.total!==page.total) || new Set(matches.map(match=>match.id)).size!==matches.length
        || matches.length>page.total || (page.next===null && matches.length!==page.total))throw new Error('ARENA_HISTORY_CONTRACT_INVALID');
      const data={key,matches,total:page.total,revision:page.revision,next:page.next};latest.current=data;
      setState({key,status:'ready',data});return rows;
    } catch(error) {
      if(controller.signal.aborted || request.current!==controller || context.current!==key)return null;
      setState({key,status:'error',data:previous,error:error instanceof Error && error.message.startsWith('ARENA_HISTORY_')?error.message:'ARENA_HISTORY_UNAVAILABLE'});
      return null;
    } finally {if(request.current===controller)request.current=null;}
  },[key,scope]);
  useEffect(()=>{
    context.current=key;latest.current=null;
    return()=>{context.current=null;request.current?.abort();request.current=null;latest.current=null;};
  },[key]);
  const seed=useCallback((matches:ArenaMatch[])=>{
    if(!key || context.current!==key || latest.current || request.current)return;
    const data={key,matches,total:null,revision:null,next:null};latest.current=data;setState({key,status:'cached',data});
  },[key]);
  const reload=useCallback(()=>read(false),[read]);
  const loadMore=useCallback(()=>read(true),[read]);
  const current=state?.key===key?state:null;
  return {matches:current?.data?.matches??empty,total:current?.data?.total??null,
    cached:current?.data?.revision===null,loading:Boolean(key) && (!current || current.status==='loading'),
    loadingMore:current?.status==='more',hasMore:current?.data?.next!=null,
    error:current?.status==='error'?current.error??'ARENA_HISTORY_UNAVAILABLE':null,reload,loadMore,seed};
}
