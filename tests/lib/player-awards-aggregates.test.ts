import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {buildPlayerAwardsFromAggregates} from '../../packages/domain/player-awards';
import {arenaAnalyticsScope,parseArenaAnalyticsReport} from '../../packages/domain/arena-analytics';
import {arenaId,arenaReportFixture} from '../fixtures/arena-analytics';
describe('complete player award counters',()=>{
  it('uses single-match maximum healing and starting selections, not visible match pages',()=>{
    const row=arenaReportFixture().players[0];const awards=buildPlayerAwardsFromAggregates([row]);
    expect(awards.find(award=>award.kind==='healing_master')).toMatchObject({value:18});
    expect(awards.find(award=>award.kind==='beginners_luck')).toMatchObject({value:2});
    expect(awards.find(award=>award.kind==='veteran')).toMatchObject({gamesPlayed:3,winRate:50});
  });
  it('keeps the five-game threshold and a neutral all-draw record',()=>{
    const players=[4,5,6].map((games,index)=>({...arenaReportFixture().players[0],key:`user:${arenaId(index+1)}`,user_id:arenaId(index+1),display_name:String(games),games_played:games,wins:index===2?3:2,draws:1}));
    const kings=buildPlayerAwardsFromAggregates(players).filter(award=>award.kind==='arena_king');
    expect(kings.map(award=>award.name)).toEqual(['6','5']);
    const allDraw={...players[2],wins:0,draws:6,combo_wins:0};
    expect(buildPlayerAwardsFromAggregates([allDraw]).some(award=>award.kind==='arena_king')).toBe(false);
    expect(buildPlayerAwardsFromAggregates([])).toEqual([]);
  });
  it('breaks identical-name score ties by stable identity regardless of input ordering',()=>{
    const row={...arenaReportFixture().players[0],display_name:'Same name',games_played:5,draws:1};
    const a={...row,key:`user:${arenaId(1)}`,user_id:arenaId(1),wins:1};
    const b={...row,key:`user:${arenaId(2)}`,user_id:arenaId(2),wins:3};
    const veterans=(rows:typeof a[])=>buildPlayerAwardsFromAggregates(rows).filter(award=>award.kind==='veteran');
    expect(veterans([a,b])).toEqual(veterans([b,a]));expect(veterans([a,b])[0].winRate).toBe(25);
  });
  it.skipIf(!process.env.ARENA_BUNDLE_SQL_PAYLOAD_PATH)('uses full actual SQL counters beyond the history page cap',()=>{
    const value=JSON.parse(readFileSync(process.env.ARENA_BUNDLE_SQL_PAYLOAD_PATH!,'utf8'));
    const report=parseArenaAnalyticsReport(value,arenaAnalyticsScope(value.groupId,value.filters));
    expect(buildPlayerAwardsFromAggregates(report.players).filter(award=>award.kind==='veteran')[0].gamesPlayed).toBeGreaterThan(1000);
  });
});
