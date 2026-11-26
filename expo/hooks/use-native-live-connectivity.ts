import {useEffect,useLayoutEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';
import NetInfo from '@react-native-community/netinfo';
import {AppState} from 'react-native';
import type {useLiveGameCommandScope} from './use-live-game-command-scope';
import {applyLiveGameImmersive} from '@/lib/live-game-immersive';
import {persistLiveGameTelemetry} from '@/lib/live-game-telemetry';
type Ports={
 currentUserId:string|undefined;
 scope:Pick<ReturnType<typeof useLiveGameCommandScope>,'epoch'|'isCurrent'|'bindClient'>;
 syncJournal:()=>Promise<void>;resumeRemoteGame:()=>Promise<void>;refreshAuthoritativeState:()=>Promise<void>;
 setSetupRetry:Dispatch<SetStateAction<number>>;
 setSyncStatus:Dispatch<SetStateAction<'offline'|'pending'|'syncing'|'synced'|'error'>>;
 getLiveGameId:()=>string|null;cancelScheduledSync:()=>void;getTelemetrySessionId:()=>string;
};
/** Owns platform subscriptions and timers; the session owner retains its private journal. */
export function useNativeLiveConnectivity(ports:Ports){
 const [networkOnline,setNetworkOnline]=useState(true);
 const latest=useRef(ports);
 useLayoutEffect(()=>{latest.current=ports;},[ports]);
 const {epoch,isCurrent}=ports.scope;
 useEffect(()=>{
  let mounted=true,reading=false;
  const active=()=>mounted&&isCurrent();
  const unsubscribe=NetInfo.addEventListener(state=>{
   if(!active())return;
   const current=latest.current;
   const online=state.isConnected===true&&state.isInternetReachable!==false;
   setNetworkOnline(online);
   if(!online){current.cancelScheduledSync();current.setSyncStatus('offline');return;}
   void current.syncJournal().catch(()=>undefined);
  });
  const interval=setInterval(()=>{
   if(!active()||reading)return;
   reading=true;
   void NetInfo.fetch().then(state=>{
    if(!active()||state.isConnected!==true||state.isInternetReachable===false)return;
    const current=latest.current;
    void current.syncJournal().catch(()=>undefined);
    void current.resumeRemoteGame().catch(()=>undefined);
    current.setSetupRetry(value=>value+1);
   }).catch(()=>undefined).finally(()=>{reading=false;});
  },10000);
  const app=AppState.addEventListener('change',state=>{
   if(!active())return;
   const current=latest.current;
   if(state==='active'){
    void current.resumeRemoteGame().catch(()=>undefined);
    void current.refreshAuthoritativeState().catch(()=>undefined)
     .then(()=>active()?latest.current.syncJournal():undefined).catch(()=>undefined);
    if(current.getLiveGameId())applyLiveGameImmersive();
   }else if(current.currentUserId){
    try{
     const bound=current.scope.bindClient();
     void persistLiveGameTelemetry(bound.client,{userId:current.currentUserId,liveGameId:current.getLiveGameId(),
      sessionId:current.getTelemetrySessionId(),platform:'expo',force:true}).catch(()=>undefined);
    }catch{/* Auth transition: omit telemetry rather than adopting another session. */}
   }
  });
  return()=>{
   mounted=false;clearInterval(interval);unsubscribe();app.remove();
   // A newer epoch already reset its own timer in layout; never clear its new work.
   if(latest.current.scope.epoch===epoch)latest.current.cancelScheduledSync();
  };
 },[epoch,isCurrent]);
 return{networkOnline};
}
