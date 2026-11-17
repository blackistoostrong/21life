import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {fetchCompleteArenaHistoryDay} from '@/lib/arena-history-query';
import type {ArenaHistoryMatch,ArenaHistoryScope} from '../../packages/domain/arena-history';
type State={key:string;status:'loading'|'error'|'ready';matches:ArenaHistoryMatch[];error:string|null};
const empty:ArenaHistoryMatch[]=[];

/** Prepare the complete export while its dialog is open, before the share gesture. */
export function useArenaDayExport(userId:string|undefined,scope:ArenaHistoryScope|null,dayKey:string|null) {
  const key=userId && scope && dayKey?JSON.stringify([userId,scope,dayKey,'v2']):null;
  const [state,setState]=useState<State|null>(null),[revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!key || !scope || !dayKey)return;
    let active=true;const controller=new AbortController();
    setState({key,status:'loading',matches:[],error:null});
    void fetchCompleteArenaHistoryDay(supabase,scope,dayKey,controller.signal).then(matches=>{
      if(active)setState({key,status:'ready',matches,error:null});
    }).catch(error=>{
      if(active)setState({key,status:'error',matches:[],error:error instanceof Error && error.message.startsWith('ARENA_HISTORY_')?error.message:'ARENA_HISTORY_UNAVAILABLE'});
    });
    return()=>{active=false;controller.abort();};
  },[key,scope,dayKey,revision]);
  const current=state?.key===key?state:null;
  return {matches:current?.status==='ready'?current.matches:empty,ready:current?.status==='ready',
    loading:key!==null && (!current || current.status==='loading'),error:current?.error??null,retry:()=>setRevision(value=>value+1)};
}
