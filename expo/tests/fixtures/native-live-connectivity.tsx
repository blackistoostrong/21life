import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useLiveGameCommandScope} from '../../hooks/use-live-game-command-scope';
import {useNativeLiveConnectivity} from '../../hooks/use-native-live-connectivity';
const calls:string[]=[];
type Connection={isConnected:boolean;isInternetReachable:boolean};
const networks:{active:boolean;event:(value:Connection)=>void}[]=[];
const states:{active:boolean;event:(value:string)=>void}[]=[];
const reads:((value:Connection)=>void)[]=[];
const syncJournal=async()=>{calls.push('sync');},resumeRemoteGame=async()=>{calls.push('resume');},
 refreshAuthoritativeState=async()=>{calls.push('refresh');},setSetupRetry=()=>{calls.push('retry');},
 setSyncStatus=()=>{calls.push('status');},cancelScheduledSync=()=>{calls.push('cancel');};
function Owner({actor,token}:{actor:string;token:string}){
 const scope=useLiveGameCommandScope(actor,'g',{user:{id:actor},access_token:token});
 const ports={currentUserId:actor,syncJournal,resumeRemoteGame,refreshAuthoritativeState,setSetupRetry,setSyncStatus,
  scope,getLiveGameId:()=>'game',cancelScheduledSync,getTelemetrySessionId:()=>'session'};
 const {networkOnline}=useNativeLiveConnectivity(ports);
 return <output data-testid="connectivity">{actor}:{String(networkOnline)}</output>;
}
const root=createRoot(document.getElementById('root')!);
Object.assign(window,{liveOSPorts:{
 network:(event:(value:Connection)=>void)=>{const slot={event,active:true};networks.push(slot);return()=>{slot.active=false;};},
 state:(event:(value:string)=>void)=>{const slot={event,active:true};states.push(slot);return{remove:()=>{slot.active=false;}};},
 fetch:()=>new Promise<Connection>(reply=>reads.push(reply)),
 immersive:()=>{calls.push('immersive');},telemetry:(actor:string)=>{calls.push('telemetry:'+actor);},
},liveConnectivityHarness:{
 render:(actor='a',token='token-a')=>flushSync(()=>root.render(<Owner actor={actor} token={token}/>)),
 snapshot:()=>({calls:[...calls],reads:reads.length,network:networks.filter(item=>item.active).length,app:states.filter(item=>item.active).length}),
 clear:()=>{calls.length=0;},reply:(index:number)=>reads[index]({isConnected:true,isInternetReachable:true}),
 offline:()=>networks.filter(item=>item.active).forEach(item=>item.event({isConnected:false,isInternetReachable:false})),
 background:()=>states.filter(item=>item.active).forEach(item=>item.event('background')),
 unmount:()=>flushSync(()=>root.unmount()),
}});
