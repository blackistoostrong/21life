import {arenaHistoryScope,parseArenaHistoryCursor,parseArenaHistoryDaySummaries,parseArenaHistoryPage,
  type ArenaHistoryCursor,type ArenaHistoryScope} from '../domain/arena-history';
import {withRequestDeadline} from './request-deadline';

export interface ArenaHistoryRpcClient {
  rpc(name:string,args:Record<string,unknown>):{abortSignal(signal:AbortSignal):PromiseLike<{data:unknown;error:unknown|null}>};
}
function unavailable(error:unknown):never {
  const code=error!==null && typeof error==='object' && 'code' in error?error.code:null;
  throw new Error(code==='40001'?'ARENA_HISTORY_CHANGED':code==='42501'?'ARENA_HISTORY_FORBIDDEN':'ARENA_HISTORY_UNAVAILABLE');
}
function bounded(value:unknown):unknown {
  if((JSON.stringify(value)?.length??0)*2>8*1024*1024)throw new Error('ARENA_HISTORY_TOO_LARGE');
  return value;
}
export async function fetchArenaHistoryPage(client:ArenaHistoryRpcClient,input:ArenaHistoryScope,
  cursor:ArenaHistoryCursor|null=null,revision:string|null=null,signal?:AbortSignal) {
  const scope=arenaHistoryScope(input.groupId,input);
  const position=cursor===null?null:parseArenaHistoryCursor(cursor);
  if((position!==null && revision===null)||(revision!==null && !/^[a-f0-9]{32}$/.test(revision)))throw new Error('ARENA_HISTORY_CONTRACT_INVALID');
  const {data,error}=await withRequestDeadline(client.rpc('get_arena_history_page_v2',{
    p_group_id:scope.groupId,p_limit:scope.limit,p_before_time:position?.playedAt??null,p_before_id:position?.id??null,
    p_revision:revision,p_since:scope.since,p_until:scope.until,p_day_key:scope.dayKey,p_boundary_hour:scope.boundaryHour,
  }),15000,signal,'ARENA_HISTORY_TIMEOUT');
  if(error)unavailable(error);
  return parseArenaHistoryPage(bounded(data),scope,position,revision);
}
export async function fetchArenaHistoryDaySummaries(client:ArenaHistoryRpcClient,groupId:string,boundaryHour=8,signal?:AbortSignal) {
  const scope=arenaHistoryScope(groupId,{boundaryHour});
  const {data,error}=await withRequestDeadline(client.rpc('get_arena_match_day_summaries_v2',{
    p_group_id:scope.groupId,p_boundary_hour:scope.boundaryHour,
  }),15000,signal,'ARENA_HISTORY_TIMEOUT');
  if(error)unavailable(error);
  return parseArenaHistoryDaySummaries(bounded(data),scope.groupId,scope.boundaryHour);
}
