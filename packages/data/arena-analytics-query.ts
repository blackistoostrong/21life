import {arenaAnalyticsScope,parseArenaAnalyticsReport,type ArenaAnalyticsScope} from '../domain/arena-analytics';
import {withRequestDeadline,type RpcTransport} from './request-deadline';
type Rows=Array<Record<string,unknown>>;
export type ArenaAnalyticsReport={totalMatches:number;players:Rows;commanders:Rows;colors:Rows;decks:Rows};
export async function fetchArenaAnalyticsReport(client:RpcTransport,groupId:string,since:string|null,signal?:AbortSignal):Promise<ArenaAnalyticsReport> {
  const {data,error}=await withRequestDeadline(client.rpc('get_arena_analytics_bundle',{
    p_group_id:groupId,p_since:since,p_until:null,
  }),15000,signal,'ARENA_ANALYTICS_TIMEOUT');
  if(error)throw new Error('ARENA_ANALYTICS_UNAVAILABLE');
  if(!data || typeof data!=='object' || Array.isArray(data))throw new Error('ARENA_ANALYTICS_CONTRACT_INVALID');
  const row=data as Record<string,unknown>;
  if(typeof row.totalMatches!=='number' || !Number.isSafeInteger(row.totalMatches) || row.totalMatches<0
    || ['players','commanders','colors','decks'].some(field=>!Array.isArray(row[field])
      || (row[field] as unknown[]).some(item=>!item || typeof item!=='object' || Array.isArray(item))))throw new Error('ARENA_ANALYTICS_CONTRACT_INVALID');
  return row as ArenaAnalyticsReport;
}

/** Strict v2 transport. Legacy consumers remain separate until the Dev schema is applied. */
export async function fetchArenaAnalyticsV2(client:RpcTransport,input:ArenaAnalyticsScope,signal?:AbortSignal) {
  const scope=arenaAnalyticsScope(input.groupId,input);
  const {data,error}=await withRequestDeadline(client.rpc('get_arena_analytics_bundle_v2',{
    p_group_id:scope.groupId,p_since:scope.since,p_until:scope.until,p_bracket:scope.bracket,
  }),15000,signal,'ARENA_ANALYTICS_TIMEOUT');
  if(error)throw new Error('ARENA_ANALYTICS_UNAVAILABLE');
  if((JSON.stringify(data)?.length??0)*2>8*1024*1024)throw new Error('ARENA_ANALYTICS_TOO_LARGE');
  return parseArenaAnalyticsReport(data,scope);
}
