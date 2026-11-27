import {test,expect} from '@playwright/test';
import {buildPublicArenaAnalytics} from '../../lib/public-arena-analytics';
import {arenaReportFixture} from '../fixtures/arena-analytics';
import {arenaAnalyticsScope,parseArenaAnalyticsReport} from '../../packages/domain/arena-analytics';

for(const [outcome,wins,draws,label,record] of [
 ['draw-only',0,3,'—','0W-0L-3D'],
 ['losses',0,0,'0%','0W-3L-0D'],
 ['mixed',1,1,'50%','1W-1L-1D'],
] as const){
 test(`public arena rates distinguish ${outcome} records`,async({page})=>{
  const report=arenaReportFixture();
  for(const row of [...report.players,...report.commanders,...report.colors,...report.decks]){
   row.wins=wins;row.draws=draws;
   if('combo_wins'in row)row.combo_wins=0;
   if('alternate_wins'in row)row.alternate_wins=0;
   if('comeback_wins'in row)row.comeback_wins=0;
   if('last_standing_wins'in row)row.last_standing_wins=0;
   if('concession_wins'in row)row.concession_wins=0;
   if('second_places'in row)row.second_places=0;
   if('median_winning_duration_seconds'in row)row.median_winning_duration_seconds=null;
  }
  parseArenaAnalyticsReport(report,arenaAnalyticsScope(report.groupId));
  const payload={...buildPublicArenaAnalytics(report),recentMatches:[],arena:{name:'Neutral public fixture',description:null,
   inviteCode:'NEUTRAL',createdAt:'2026-01-01T00:00:00Z',seasonsEnabled:false,seasonStart:null,seasonEnd:null}};
  await page.route('**/api/public-arena/NEUTRAL',route=>route.fulfill({json:payload}));
  await page.goto('/arena/NEUTRAL');
  await expect(page.getByRole('heading',{name:'Neutral public fixture',exact:true})).toBeVisible();
  await expect(page.getByText(`${label} · ${record}`,{exact:true}).first()).toBeVisible();
  await expect(page.getByText(`100% of meta · ${label} WR`,{exact:true}).first()).toBeVisible();
  if(outcome==='draw-only'){
   await expect(page.getByText(`0% · ${record}`,{exact:true})).toHaveCount(0);
   await expect(page.getByText('100% of meta · 0% WR',{exact:true})).toHaveCount(0);
  }
 });
}
