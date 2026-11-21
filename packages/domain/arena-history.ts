import { ARENA_DAY_BOUNDARY_HOUR } from './arena-session';

export interface ArenaHistoryScope {
  groupId:string;
  since:string|null;
  until:string|null;
  dayKey:string|null;
  boundaryHour:number;
  limit:number;
}
export interface ArenaHistoryCursor {playedAt:string|null;id:string;}
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid():never {throw new Error('ARENA_HISTORY_CONTRACT_INVALID');}
function object(value:unknown):Record<string,unknown> {
  return value!==null && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : invalid();
}
function uuid(value:unknown):string {return typeof value==='string' && uuidPattern.test(value) ? value.toLowerCase() : invalid();}
function nullableUuid(value:unknown):string|null {return value===null?null:uuid(value);}
function count(value:unknown):number {return typeof value==='number' && Number.isSafeInteger(value) && value>=0?value:invalid();}
function timestamp(value:unknown):string {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value)))return invalid();
  const calendar=value.slice(0,10);
  if(new Date(calendar+'T00:00:00Z').toISOString().slice(0,10)!==calendar)return invalid();
  return value;
}
function nullableTimestamp(value:unknown):string|null {return value===null?null:timestamp(value);}
function dayKey(value:unknown):string {
  if(value==='undated')return value;
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return invalid();
  timestamp(value+'T00:00:00Z');return value;
}
function revision(value:unknown):string {return typeof value==='string' && /^[a-f0-9]{32}$/.test(value)?value:invalid();}
function nullableText(value:unknown):string|null {return value===null?null:typeof value==='string'?value:invalid();}

/** Milliseconds alone cannot distinguish PostgreSQL microsecond tie-breaks. */
function timeParts(value:string):[number,number] {
  const fraction=value.match(/\.(\d+)(?:Z|[+-])/im)?.[1]??'';
  return [Date.parse(value),Number(fraction.padEnd(6,'0').slice(3,6))];
}
export function compareArenaHistoryTime(a:string,b:string):number {
  const left=timeParts(a),right=timeParts(b);
  return left[0]-right[0] || left[1]-right[1];
}
/** Negative means a precedes b in DESC timestamp/UUID order, null dates last. */
export function compareArenaHistoryCursor(a:ArenaHistoryCursor,b:ArenaHistoryCursor):number {
  if(a.playedAt===null && b.playedAt!==null)return 1;
  if(a.playedAt!==null && b.playedAt===null)return -1;
  const time=a.playedAt!==null && b.playedAt!==null ? compareArenaHistoryTime(b.playedAt,a.playedAt):0;
  return time || (a.id===b.id?0:a.id>b.id?-1:1);
}
export function parseArenaHistoryCursor(value:unknown):ArenaHistoryCursor {
  const row=object(value);return {playedAt:nullableTimestamp(row.playedAt),id:uuid(row.id)};
}
export function arenaHistoryScope(groupId:string,filters:Partial<Omit<ArenaHistoryScope,'groupId'>>={}):ArenaHistoryScope {
  const scope={groupId:uuid(groupId),since:nullableTimestamp(filters.since??null),until:nullableTimestamp(filters.until??null),
    dayKey:filters.dayKey==null?null:dayKey(filters.dayKey),boundaryHour:filters.boundaryHour??ARENA_DAY_BOUNDARY_HOUR,limit:filters.limit??100};
  if(!Number.isInteger(scope.boundaryHour)||scope.boundaryHour<0||scope.boundaryHour>23
    || !Number.isInteger(scope.limit)||scope.limit<1||scope.limit>100
    || (scope.since!==null && scope.until!==null && compareArenaHistoryTime(scope.since,scope.until)>=0))return invalid();
  return scope;
}

function participant(value:unknown,matchId:string) {
  const row=object(value);
  const result={...row,id:uuid(row.id),match_id:uuid(row.match_id),user_id:nullableUuid(row.user_id),guest_id:nullableUuid(row.guest_id),
    deck_id:nullableUuid(row.deck_id),guest_deck_id:nullableUuid(row.guest_deck_id)};
  if(result.match_id!==matchId || typeof row.is_winner!=='boolean')return invalid();
  return {...result,is_winner:row.is_winner};
}
function match(value:unknown,scope:ArenaHistoryScope) {
  const row=object(value);
  const id=uuid(row.id),groupId=uuid(row.group_id),playedAt=nullableTimestamp(row.played_at),key=dayKey(row.arena_day_key);
  if(groupId!==scope.groupId || (playedAt===null)!==(key==='undated') || (scope.dayKey!==null && key!==scope.dayKey)
    || (scope.since!==null && (playedAt===null || compareArenaHistoryTime(playedAt,scope.since)<0))
    || (scope.until!==null && (playedAt===null || compareArenaHistoryTime(playedAt,scope.until)>=0))
    || !Array.isArray(row.match_participants) || row.match_participants.length>1000
    || (row.is_draw!==null && typeof row.is_draw!=='boolean'))return invalid();
  const participants=Array.from(row.match_participants,item=>participant(item,id));
  if(new Set(participants.map(item=>item.id)).size!==participants.length)return invalid();
  return {...row,id,group_id:groupId,played_at:playedAt,arena_day_key:key,created_by:nullableUuid(row.created_by),
    notes:nullableText(row.notes),winner_id:nullableUuid(row.winner_id),winner_guest_id:nullableUuid(row.winner_guest_id),
    is_draw:row.is_draw as boolean|null,match_participants:participants};
}
export type ArenaHistoryMatch=ReturnType<typeof match>;
function sameTime(actual:string|null,expected:string|null):boolean {
  return actual===null || expected===null ? actual===expected : compareArenaHistoryTime(actual,expected)===0;
}
export function parseArenaHistoryPage(value:unknown,scope:ArenaHistoryScope,cursor:ArenaHistoryCursor|null=null,expectedRevision:string|null=null) {
  const row=object(value),filters=object(row.filters);
  if(row.schemaVersion!==2 || row.complete!==true || uuid(row.groupId)!==scope.groupId
    || !sameTime(nullableTimestamp(filters.since),scope.since) || !sameTime(nullableTimestamp(filters.until),scope.until)
    || filters.dayKey!==scope.dayKey || filters.boundaryHour!==scope.boundaryHour || !Array.isArray(row.matches)
    || row.matches.length>scope.limit)return invalid();
  const actualRevision=revision(row.revision),total=count(row.total);
  if(expectedRevision!==null && actualRevision!==expectedRevision)return invalid();
  const matches=Array.from(row.matches,item=>match(item,scope));
  const next=row.next===null?null:parseArenaHistoryCursor(row.next);
  if(total<matches.length || new Set(matches.map(item=>item.id)).size!==matches.length)return invalid();
  let previous=cursor;
  for(const item of matches) {
    const current={playedAt:item.played_at,id:item.id};
    if(previous!==null && compareArenaHistoryCursor(previous,current)>=0)return invalid();
    previous=current;
  }
  if(next!==null && (matches.length!==scope.limit || total<=matches.length || previous===null
    || compareArenaHistoryCursor(next,previous)!==0))return invalid();
  if(cursor===null && next===null && total!==matches.length)return invalid();
  return {schemaVersion:2 as const,complete:true as const,asOf:timestamp(row.asOf),groupId:scope.groupId,
    revision:actualRevision,total,filters:{since:scope.since,until:scope.until,dayKey:scope.dayKey,boundaryHour:scope.boundaryHour},matches,next};
}
export type ArenaHistoryPage=ReturnType<typeof parseArenaHistoryPage>;

export function parseArenaHistoryDaySummaries(value:unknown,groupId:string,boundaryHour=ARENA_DAY_BOUNDARY_HOUR) {
  const row=object(value);groupId=uuid(groupId);
  if(row.schemaVersion!==2 || row.complete!==true || uuid(row.groupId)!==groupId || row.boundaryHour!==boundaryHour || !Array.isArray(row.days))return invalid();
  const days=Array.from(row.days,value=>{
    const day=object(value),key=dayKey(day.dayKey),matchCount=count(day.matchCount),latestPlayedAt=nullableTimestamp(day.latestPlayedAt);
    if(matchCount===0 || (key==='undated')!==(latestPlayedAt===null))return invalid();
    return {dayKey:key,matchCount,latestPlayedAt};
  });
  const totalDays=count(row.totalDays);
  if(days.length!==totalDays || new Set(days.map(day=>day.dayKey)).size!==totalDays)return invalid();
  for(let i=1;i<days.length;i++) {
    const previous=days[i-1].dayKey,current=days[i].dayKey;
    if(previous==='undated' || (current!=='undated' && previous<=current))return invalid();
  }
  return {schemaVersion:2 as const,complete:true as const,asOf:timestamp(row.asOf),groupId,boundaryHour,totalDays,days};
}
