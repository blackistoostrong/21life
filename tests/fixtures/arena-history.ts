export const historyId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const historyGroup=historyId(100);
export const historyRevision='a'.repeat(32);
export function historyMatch(n:number,playedAt:string|null,dayKey:string) {
  return {id:historyId(n),group_id:historyGroup,created_by:historyId(101),played_at:playedAt,arena_day_key:dayKey,
    notes:null,winner_id:null,winner_guest_id:null,is_draw:true,match_participants:[]};
}
export function historyPageFixture() {
  return {schemaVersion:2,complete:true,asOf:'2026-11-17T08:00:00.123456+00:00',groupId:historyGroup,
    revision:historyRevision,total:4,filters:{since:null,until:null,dayKey:null,boundaryHour:8},
    matches:[historyMatch(4,'2010-01-05T01:00:00+00:00','2010-01-05'),historyMatch(3,'2010-01-02T01:00:00+00:00','2010-01-01'),
      historyMatch(2,'2010-01-01T21:00:00+00:00','2010-01-01'),historyMatch(1,null,'undated')],next:null as {playedAt:string|null;id:string}|null};
}
export function historyDaysFixture() {
  return {schemaVersion:2,complete:true,asOf:'2026-11-17T08:00:00.123456+00:00',groupId:historyGroup,boundaryHour:8,totalDays:3,
    days:[{dayKey:'2010-01-05',matchCount:1,latestPlayedAt:'2010-01-05T01:00:00Z'},
      {dayKey:'2010-01-01',matchCount:2,latestPlayedAt:'2010-01-02T01:00:00Z'},{dayKey:'undated',matchCount:1,latestPlayedAt:null}]};
}
