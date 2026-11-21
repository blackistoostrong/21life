import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {arenaHistoryScope,compareArenaHistoryCursor,parseArenaHistoryDaySummaries,parseArenaHistoryPage} from '../../packages/domain/arena-history';
import {historyDaysFixture,historyGroup,historyId,historyMatch,historyPageFixture,historyRevision} from '../fixtures/arena-history';

describe('arena history complete-page contract',()=>{
  const scope=arenaHistoryScope(historyGroup);
  it('retains explicit unknown dates and conditional server day labels',()=>{
    const page=parseArenaHistoryPage(historyPageFixture(),scope);
    expect(page.total).toBe(4);expect(page.matches.at(-1)?.played_at).toBeNull();
    expect(page.matches.map(match=>match.arena_day_key)).toEqual(['2010-01-05','2010-01-01','2010-01-01','undated']);
    expect(parseArenaHistoryPage({...historyPageFixture(),total:0,matches:[]},scope).matches).toEqual([]);
    expect(()=>parseArenaHistoryPage({...historyPageFixture(),matches:[]},scope)).toThrow('ARENA_HISTORY_CONTRACT_INVALID');
  });
  it.each(['legacy','partial','group','filter','boundary','revision','total','duplicates','order','undated','date','winner','notes','shape','cursor'])('rejects invalid %s responses',type=>{
    const input=historyPageFixture();
    if(type==='legacy')input.schemaVersion=1;
    if(type==='partial')input.complete=false;
    if(type==='group')input.groupId=historyId(200);
    if(type==='filter')Reflect.set(input.filters,'since','2009-01-01T00:00:00Z');
    if(type==='boundary')input.filters.boundaryHour=9;
    if(type==='revision')input.revision='legacy';
    if(type==='total')input.total=3;
    if(type==='duplicates')input.matches[1]=input.matches[0];
    if(type==='order')input.matches.reverse();
    if(type==='undated')input.matches[3].arena_day_key='2010-01-01';
    if(type==='date')input.matches[0].played_at='2010-02-30T00:00:00Z';
    if(type==='winner')Reflect.set(input.matches[0],'winner_id','invalid');
    if(type==='notes')Reflect.set(input.matches[0],'notes',4);
    if(type==='shape')Reflect.set(input.matches[0],'match_participants',null);
    if(type==='cursor')input.next={playedAt:input.matches[0].played_at,id:input.matches[0].id};
    expect(()=>parseArenaHistoryPage(input,scope)).toThrow('ARENA_HISTORY_CONTRACT_INVALID');
  });
  it('validates period/group/participant references without inventing missing identities',()=>{
    const input=historyPageFixture();const match=input.matches[0];
    const participant={id:historyId(300),match_id:match.id,user_id:null,guest_id:null,deck_id:null,guest_deck_id:null,is_winner:false,
      participant_name_snapshot:'Deleted player',commander_snapshot:'Historical commander'};
    Reflect.set(match,'match_participants',[participant]);
    expect(parseArenaHistoryPage(input,scope).matches[0].match_participants[0].user_id).toBeNull();
    Reflect.set(match,'match_participants',[participant,participant]);
    expect(()=>parseArenaHistoryPage(input,scope)).toThrow();
    Reflect.set(match,'match_participants',[{...participant,match_id:historyId(999)}]);
    expect(()=>parseArenaHistoryPage(input,scope)).toThrow();
    expect(()=>parseArenaHistoryPage(historyPageFixture(),arenaHistoryScope(historyGroup,{dayKey:'2010-01-05'}))).toThrow();
    const filtered={...historyPageFixture(),matches:[historyPageFixture().matches[0]],total:1,filters:{since:'2010-01-05T00:00:00+00:00',until:'2010-01-06T00:00:00+00:00',dayKey:null,boundaryHour:8}};
    expect(parseArenaHistoryPage(filtered,arenaHistoryScope(historyGroup,{since:'2010-01-05T00:00:00Z',until:'2010-01-06T00:00:00Z'})).total).toBe(1);
    filtered.matches=[historyMatch(8,'2010-01-06T00:00:00Z','2010-01-06')];
    expect(()=>parseArenaHistoryPage(filtered,arenaHistoryScope(historyGroup,{since:filtered.filters.since,until:filtered.filters.until}))).toThrow();
  });
  it('requires stable revision, cursor continuation and exact last visible row',()=>{
    const input=historyPageFixture();input.matches=input.matches.slice(0,2);
    input.next={playedAt:input.matches[1].played_at,id:input.matches[1].id};
    const small=arenaHistoryScope(historyGroup,{limit:2});
    expect(parseArenaHistoryPage(input,small,null,historyRevision).next).toEqual(input.next);
    expect(()=>parseArenaHistoryPage(input,small,input.next,historyRevision)).toThrow();
    expect(()=>parseArenaHistoryPage(input,small,null,'b'.repeat(32))).toThrow();
    input.next.id=historyId(999);expect(()=>parseArenaHistoryPage(input,small)).toThrow();
  });
  it('preserves PostgreSQL microsecond order and offset-equivalent timestamps',()=>{
    const input=historyPageFixture();input.total=2;input.matches=[historyMatch(1,'2026-01-01T00:00:00.000002Z','2026-01-01'),historyMatch(2,'2026-01-01T00:00:00.000001Z','2026-01-01')];
    expect(parseArenaHistoryPage(input,scope).matches[0].id).toBe(historyId(1));
    expect(compareArenaHistoryCursor({id:historyId(1),playedAt:'2026-01-01T01:00:00.000002+01:00'},{id:historyId(1),playedAt:'2026-01-01T00:00:00.000002Z'})).toBe(0);
    input.matches.reverse();expect(()=>parseArenaHistoryPage(input,scope)).toThrow();
    expect(()=>arenaHistoryScope(historyGroup,{since:'2026-01-01T00:00:00.000002Z',until:'2026-01-01T00:00:00.000001Z'})).toThrow();
  });
  it.each([{limit:0},{limit:101},{boundaryHour:-1},{boundaryHour:24},{dayKey:'2026-02-30'},{since:'bad'},{since:'2010-01-01T00:00:00Z',until:'2010-01-01T00:00:00Z'}])('rejects invalid query scope %j',filters=>{
    expect(()=>arenaHistoryScope(historyGroup,filters)).toThrow('ARENA_HISTORY_CONTRACT_INVALID');
  });
});

describe('complete arena-day summaries',()=>{
  it('keeps counts for 1001 days without the REST table cap',()=>{
    const input=historyDaysFixture();input.days=Array.from({length:1001},(_,n)=>{
      const stamp=new Date(Date.UTC(2000,0,1)+(1000-n)*86400000).toISOString();return {dayKey:stamp.slice(0,10),matchCount:1,latestPlayedAt:stamp};
    });input.totalDays=1001;
    expect(parseArenaHistoryDaySummaries(input,historyGroup).days).toHaveLength(1001);
    expect(parseArenaHistoryDaySummaries(historyDaysFixture(),historyGroup).days.at(-1)?.latestPlayedAt).toBeNull();
  });
  it.each(['total','duplicate','order','zero','chronology','boundary','asOf'])('rejects invalid summary %s',type=>{
    const input=historyDaysFixture();
    if(type==='total')input.totalDays=2;
    if(type==='duplicate')input.days[1]=input.days[0];
    if(type==='order')input.days.reverse();
    if(type==='zero')input.days[0].matchCount=0;
    if(type==='chronology')input.days[2].latestPlayedAt='2010-01-01T00:00:00Z';
    if(type==='boundary')input.boundaryHour=9;
    if(type==='asOf')input.asOf='invalid';
    expect(()=>parseArenaHistoryDaySummaries(input,historyGroup)).toThrow('ARENA_HISTORY_CONTRACT_INVALID');
  });
  it.skipIf(!process.env.HISTORY_SQL_PAYLOAD_PATH)('accepts the real SQL serializer, including registered/guest identities and unknown dates',()=>{
    const raw=JSON.parse(readFileSync(process.env.HISTORY_SQL_PAYLOAD_PATH!,'utf8'));
    const page=parseArenaHistoryPage(raw.page,arenaHistoryScope(raw.page.groupId));
    const summary=parseArenaHistoryDaySummaries(raw.summary,raw.page.groupId);
    expect(page.total).toBe(4);expect(summary.totalDays).toBe(3);
    const participants=page.matches.flatMap(match=>match.match_participants);
    expect(participants.some(participant=>participant.guest_id!==null)).toBe(true);
    expect(participants.some(participant=>participant.user_id!==null)).toBe(true);
  });
});
