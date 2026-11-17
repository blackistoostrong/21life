import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {arenaAnalyticsScope,parseArenaAnalyticsReport} from '../../packages/domain/arena-analytics';
import {arenaGroup,arenaId,arenaReportFixture} from '../fixtures/arena-analytics';
const scope=arenaAnalyticsScope(arenaGroup);
describe('complete arena analytics contract',()=>{
  it('retains complete counts and rich counters independently of history page size',()=>{
    const result=parseArenaAnalyticsReport(arenaReportFixture(),scope);
    expect(result.totalMatches).toBe(3);expect(result.players[0].max_life_gained).toBe(18);
    expect(result.decks[0].median_winning_duration_seconds).toBe(61);
  });
  it('retains explicit unknown colors, deck links and player identity instead of inventing records',()=>{
    const value=arenaReportFixture();value.colors=[];value.unknownColorParticipations=3;
    value.decks=[];value.unlinkedDeckParticipations=3;value.players=[];value.unlinkedPlayerParticipations=3;
    expect(parseArenaAnalyticsReport(value,scope).players).toEqual([]);
  });
  it('accepts empty complete reports and registered/guest identities',()=>{
    const value=arenaReportFixture();const row=value.players[0];row.user_id=null;row.guest_id=arenaId(2);row.is_guest=true;row.key=`guest:${row.guest_id}`;
    expect(parseArenaAnalyticsReport(value,scope).players[0].is_guest).toBe(true);
    for(const field of ['players','commanders','colors','decks','bracketOptions'])Reflect.set(value,field,[]);
    value.totalMatches=0;value.participations=0;value.rankingParticipations=0;
    expect(parseArenaAnalyticsReport(value,scope).totalMatches).toBe(0);
  });
  it.each(['version','complete','group','filters','date','population','false-zero','ranking','missing-decks','duplicate-actor','identity','record','medal','colors','options','median','physical-deck'])('rejects invalid %s without a successful empty fallback',kind=>{
    const value=arenaReportFixture();
    if(kind==='version')Reflect.set(value,'schemaVersion',1);
    if(kind==='complete')Reflect.set(value,'complete',false);
    if(kind==='group')value.groupId=arenaId(999);
    if(kind==='filters')Reflect.set(value,'filters',{});
    if(kind==='date')value.asOf='2026-02-30T00:00:00Z';
    if(kind==='population')value.participations=4;
    if(kind==='false-zero')value.totalMatches=0;
    if(kind==='ranking')value.rankingParticipations=1;
    if(kind==='missing-decks')value.decks=[];
    if(kind==='duplicate-actor')value.players.push(value.players[0]);
    if(kind==='identity')value.players[0].user_id=null;
    if(kind==='record')value.players[0].wins=3;
    if(kind==='medal')value.players[0].starts=4;
    if(kind==='colors')value.colors[0].color_identity=['H'];
    if(kind==='options')value.bracketOptions=[];
    if(kind==='median')value.decks[0].median_winning_duration_seconds=0;
    if(kind==='physical-deck')value.decks[0].key='guest:'+arenaId(10);
    expect(()=>parseArenaAnalyticsReport(value,scope)).toThrow('ARENA_ANALYTICS_CONTRACT_INVALID');
  });
  it('validates scalar metrics, duplicate groups and mutually exclusive win conditions',()=>{
    const value=arenaReportFixture();
    Reflect.set(value.players[0],'eliminations',Number.MAX_SAFE_INTEGER+1);
    expect(()=>parseArenaAnalyticsReport(value,scope)).toThrow();
    value.players[0].eliminations=1;value.players[0].alternate_wins=1;
    expect(()=>parseArenaAnalyticsReport(value,scope)).toThrow();
    value.players[0].alternate_wins=0;value.commanders.push(value.commanders[0]);
    expect(()=>parseArenaAnalyticsReport(value,scope)).toThrow();
    value.commanders.pop();value.colors[0].color_identity=['W','W'];expect(()=>parseArenaAnalyticsReport(value,scope)).toThrow();
  });
  it('binds bracket and microsecond-precise date echoes to the request',()=>{
    const value=arenaReportFixture();value.filters={since:'2026-01-01T00:00:00.000001+00:00',until:null,bracket:'3'};
    const selected=arenaAnalyticsScope(arenaGroup,{since:'2026-01-01T00:00:00.000001Z',bracket:'3'});
    expect(parseArenaAnalyticsReport(value,selected).filters.bracket).toBe('3');
    value.filters.since='2026-01-01T00:00:00.000002Z';expect(()=>parseArenaAnalyticsReport(value,selected)).toThrow();
    value.filters.since=selected.since;value.filters.bracket='2';expect(()=>parseArenaAnalyticsReport(value,selected)).toThrow();
    expect(()=>arenaAnalyticsScope(arenaGroup,{bracket:' 3'})).toThrow();
    expect(()=>arenaAnalyticsScope(arenaGroup,{bracket:'x'.repeat(33)})).toThrow();
  });
  it.skipIf(!process.env.ARENA_BUNDLE_SQL_PAYLOAD_PATH)('validates the actual rollback-only SQL serialization',()=>{
    const value=JSON.parse(readFileSync(process.env.ARENA_BUNDLE_SQL_PAYLOAD_PATH!,'utf8'));
    const result=parseArenaAnalyticsReport(value,arenaAnalyticsScope(value.groupId,value.filters));
    expect(result.totalMatches).toBeGreaterThan(1000);expect(result.players.some(row=>row.is_guest)).toBe(true);
  });
});
