import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ArenaSeasonContext} from '@/lib/arena-seasons';
import {withRequestDeadline} from '../../packages/data/request-deadline';
type State={key:string;status:'loading'|'error'}|{key:string;status:'ready';data:ArenaSeasonContext|null};
function parse(value:unknown):ArenaSeasonContext|null {
  if(!value || typeof value!=='object')throw new Error('ARENA_SEASON_CONTRACT_INVALID');
  const row=value as Record<string,unknown>;
  if(row.enabled===false)return null;
  if(row.enabled!==true || !Number.isInteger(row.resetMonth) || Number(row.resetMonth)<1 || Number(row.resetMonth)>12
    || typeof row.currentSeasonStart!=='string' || typeof row.currentSeasonEnd!=='string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.currentSeasonStart) || !/^\d{4}-\d{2}-\d{2}$/.test(row.currentSeasonEnd)
    || !Number.isFinite(Date.parse(row.currentSeasonStart)) || !Number.isFinite(Date.parse(row.currentSeasonEnd))
    || row.currentSeasonStart>=row.currentSeasonEnd || !Array.isArray(row.archives))throw new Error('ARENA_SEASON_CONTRACT_INVALID');
  return row as unknown as ArenaSeasonContext;
}
/** Owns season requests and foreground listeners; stale groups never publish archives. */
export function useArenaSeasonContext(userId:string|undefined,groupId:string) {
  const key=userId && groupId?`${userId}:${groupId}:season`:null;
  const [state,setState]=useState<State|null>(null);
  const request=useRef<AbortController|null>(null),context=useRef<string|null>(null);
  const reload=useCallback(async()=>{
    if(!key || context.current!==key)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setState({key,status:'loading'});
    try {
      const {data,error}=await withRequestDeadline(supabase.rpc('get_arena_season_context',{p_group_id:groupId}),15000,controller.signal,'ARENA_SEASON_TIMEOUT');
      if(error)throw new Error('ARENA_SEASON_UNAVAILABLE');
      const parsed=parse(data);
      if(!controller.signal.aborted && request.current===controller)setState({key,status:'ready',data:parsed});
    } catch {if(!controller.signal.aborted && request.current===controller)setState({key,status:'error'});}
  },[key,groupId]);
  useEffect(()=>{
    context.current=key;void reload();
    return()=>{context.current=null;request.current?.abort();request.current=null;};
  },[key,reload]);
  const current=state?.key===key?state:null;
  return {data:current?.status==='ready'?current.data:null,ready:current?.status==='ready',
    loading:Boolean(userId) && (!current || current.status==='loading'),error:current?.status==='error',reload};
}
