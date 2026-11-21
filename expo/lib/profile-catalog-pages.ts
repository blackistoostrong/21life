import type { AnalyticsDashboardRpcClient } from './analytics-dashboard-query';
import { withLiveGameRequestTimeout } from './live-game-async';

export type ProfileCatalogPage = { schemaVersion:2;scope:'personal'|'global';userId:string|null;revision:string;total:number;decks:Array<{id:string;[key:string]:unknown}>;next:string|null };
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid():never {throw new Error('PROFILE_CATALOG_INVALID');}
export function parseProfileCatalogPage(value:unknown, userId:string|null, after:string|null, revision:string|null):ProfileCatalogPage {
  if (!value || typeof value!=='object') return invalid();
  const row=value as ProfileCatalogPage;
  if (row.schemaVersion!==2 || row.scope!==(userId===null?'global':'personal') || row.userId!==userId
    || typeof row.revision!=='string' || !/^[a-f0-9]{32}$/.test(row.revision) || (revision!==null && row.revision!==revision)
    || !Number.isSafeInteger(row.total) || row.total<0 || row.total>10000 || !Array.isArray(row.decks) || row.decks.length>250
    || (row.next!==null && (typeof row.next!=='string' || !uuid.test(row.next)))) return invalid();
  let previous=after;
  for (const deck of row.decks) {
    if (!deck || typeof deck!=='object' || typeof deck.id!=='string' || !uuid.test(deck.id)
      || (previous!==null && deck.id<=previous) || typeof deck.name!=='string' || typeof deck.commander!=='string'
      || typeof deck.user_id!=='string' || (userId!==null && deck.user_id!==userId) || deck.group_id!==null) return invalid();
    previous=deck.id;
  }
  if ((row.next!==null && (row.decks.length!==250 || row.next!==previous)) || row.decks.length>row.total) return invalid();
  return row;
}
export async function fetchProfileCatalogPage(client:AnalyticsDashboardRpcClient,userId:string|null,after:string|null,revision:string|null,signal?:AbortSignal) {
  const name=userId===null?'get_global_profile_catalog_page_v2':'get_profile_catalog_page_v2';
  const args:Record<string,unknown>={p_after:after,p_revision:revision,p_limit:250};
  if(userId!==null) args.p_user_id=userId;
  const {data,error}=await withLiveGameRequestTimeout(client.rpc(name,args),15000,signal);
  if(error) throw new Error('PROFILE_CATALOG_UNAVAILABLE');
  return parseProfileCatalogPage(data,userId,after,revision);
}
/** Bounded traversal. No partial results escape errors, timeouts or revision changes. */
export async function fetchCompleteProfileCatalog(
  load:(after:string|null,revision:string|null,signal:AbortSignal)=>Promise<ProfileCatalogPage>,signal?:AbortSignal,
) {
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,30000);
  try {
    let after:string|null=null,revision:string|null=null,total:number|null=null,bytes=0;
    const decks:ProfileCatalogPage['decks']=[];
    for(let page=0;page<41;page++) {
      if(signal?.aborted || controller.signal.aborted) throw new Error('PROFILE_CATALOG_CANCELLED');
      const result=await load(after,revision,controller.signal);
      if(controller.signal.aborted) throw new Error('PROFILE_CATALOG_CANCELLED');
      if(total!==null && total!==result.total) return invalid();
      total=result.total;revision=result.revision;
      bytes+=JSON.stringify(result).length*2;
      if(bytes>16*1024*1024) throw new Error('PROFILE_CATALOG_TOO_LARGE');
      decks.push(...result.decks);
      if(decks.length>total) return invalid();
      if(result.next===null) {if(decks.length!==total)return invalid();return decks;}
      if(result.next===after) return invalid();
      after=result.next;
    }
    throw new Error('PROFILE_CATALOG_TOO_LARGE');
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
