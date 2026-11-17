'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {fetchArenaAnalyticsPayload,type ArenaAnalyticsBundlePayload} from '@/lib/arena-analytics-bundle';
type State={key:string;status:'ready';current:ArenaAnalyticsBundlePayload;awards:ArenaAnalyticsBundlePayload}
  |{key:string;status:'loading'|'error'};
const empty:ArenaAnalyticsBundlePayload={};

/** One account/group/period owns the current and season-award aggregate requests. */
export function useArenaAnalytics(userId:string|undefined,groupId:string,since:string|null,seasonStart:string|null) {
  const key=userId && groupId?JSON.stringify([userId,groupId,since,seasonStart,'arena-aggregate']):null;
  const [state,setState]=useState<State|null>(null);
  const request=useRef<AbortController|null>(null),context=useRef<string|null>(null);
  const reload=useCallback(async()=>{
    if(!key || context.current!==key)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setState({key,status:'loading'});
    try {
      const currentRequest=fetchArenaAnalyticsPayload(supabase,groupId,since?new Date(since):null,controller.signal);
      const awardsRequest=since && seasonStart && Date.parse(since)!==Date.parse(seasonStart)
        ?fetchArenaAnalyticsPayload(supabase,groupId,new Date(seasonStart),controller.signal):currentRequest;
      const [current,awards]=await Promise.all([currentRequest,awardsRequest]);
      if(!controller.signal.aborted && request.current===controller)setState({key,status:'ready',current,awards});
    } catch {
      if(!controller.signal.aborted && request.current===controller)setState({key,status:'error'});
    }
  },[key,groupId,since,seasonStart]);
  useEffect(()=>{
    context.current=key;void reload();
    return()=>{context.current=null;request.current?.abort();request.current=null;};
  },[key,reload]);
  const current=state?.key===key?state:null;
  return {current:current?.status==='ready'?current.current:empty,awards:current?.status==='ready'?current.awards:empty,
    ready:current?.status==='ready',loading:Boolean(userId) && (!current || current.status==='loading'),error:current?.status==='error',reload};
}
