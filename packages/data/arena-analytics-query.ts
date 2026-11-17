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
