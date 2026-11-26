import {applyLiveGameMutation,type LiveGameRecord,type QueuedLiveGameMutation} from '../../lib/live-game';

const channels:{id:string;record:(value:LiveGameRecord)=>void;status:(value:string)=>void;active:boolean}[]=[];
const remote=new Map<string,LiveGameRecord>();
const network=new Set<unknown>();const app=new Set<unknown>();
const language={copy:(key:string)=>key};const toast={showToast:()=>undefined};const router={replace:()=>undefined};
export const useLanguage=()=>language;export const useToast=()=>toast;export const useRouter=()=>router;
let reads=0;let hold=false;const creations:(()=>void)[]=[];
export async function fetchActiveLiveGame(_client:unknown,group:string,participant:string){
  reads++;return [...remote.values()].find(record=>record.group_id===group&&record.status==='active'
    &&(record.created_by===participant.slice(5)||record.state.players.some(player=>player.participantKey===participant)))??null;
}
export async function ensureLiveGameCreated(_client:unknown,record:LiveGameRecord){
  if(hold)await new Promise<void>(resolve=>{creations.push(resolve);});
  remote.set(record.id,record);return record;
}
export async function applyQueuedLiveGameMutations(_client:unknown,record:LiveGameRecord,items:QueuedLiveGameMutation[]){
  const next=items.reduce((value,item)=>({...value,state:applyLiveGameMutation(value.state,item.mutation)}),record);
  remote.set(next.id,next);return next;
}
export async function cancelLiveGame(){return undefined;}
export async function finalizePendingLiveGame(){return 'fixture-match';}
export function subscribeToLiveGame(_client:unknown,id:string,record:(value:LiveGameRecord)=>void,status:(value:string)=>void){
 const channel={id,record,status,active:true};channels.push(channel);
 queueMicrotask(()=>{if(channel.active)status('SUBSCRIBED');});
 return()=>{channel.active=false;};
}
export const NetInfo={addEventListener:(fn:unknown)=>{network.add(fn);return()=>{network.delete(fn);};},fetch:async()=>({isConnected:true,isInternetReachable:true})};
export const AppState={addEventListener:(_event:string,fn:unknown)=>{app.add(fn);return{remove:()=>{app.delete(fn);}};}};
export const probe={stats:()=>({reads,joins:channels.length,channels:channels.filter(item=>item.active).length,network:network.size,app:app.size,pending:creations.length}),
 hold:(value:boolean)=>{hold=value;},release:()=>{creations.splice(0).forEach(resolve=>resolve());},
 lateStatus:()=>{channels.filter(item=>!item.active).forEach(item=>item.status('CLOSED'));},
 end:(record:LiveGameRecord)=>{channels.filter(item=>item.active&&item.id===record.id).forEach(item=>item.record({...record,status:'ended',ended_at:'2026-11-26T01:00:00Z'}));},
};
