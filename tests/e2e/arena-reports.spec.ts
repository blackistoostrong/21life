import { test, expect } from '@playwright/test';
import { arenaReportFixture } from '../fixtures/arena-analytics';
import { fixtureLogin } from './fixture-login';
import {arenaAnalyticsScope,parseArenaAnalyticsReport} from '../../packages/domain/arena-analytics';

for(const draws of [5,0]){
 test(`arena reports distinguish ${draws===5?'draw-only records':'genuine zero-percent losses'}`,async({page})=>{
  test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
  await page.route('**/rest/v1/rpc/get_arena_analytics_bundle_v2',route=>{
   const args=route.request().postDataJSON(),report=arenaReportFixture();
   report.groupId=args.p_group_id;report.filters={since:args.p_since??null,until:args.p_until??null,bracket:args.p_bracket??null};
   report.totalMatches=5;report.participations=5;report.rankingParticipations=5;
   for(const row of [...report.players,...report.commanders,...report.colors,...report.decks]){
    const values=row as unknown as Record<string,unknown>;
    for(const key of Object.keys(values))if(typeof values[key]==='number')values[key]=0;
    if('games_played'in values)values.games_played=5;
    if('appearances'in values)values.appearances=5;
    values.draws=draws;
   }
   report.colors[0].color_identity=['W','U'];report.decks[0].median_winning_duration_seconds=null;
   parseArenaAnalyticsReport(report,arenaAnalyticsScope(report.groupId,report.filters));
   return route.fulfill({status:200,json:report});
  });
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
  await page.getByRole('tab',{name:/Players/}).click();
  const board=page.getByRole('heading',{name:'Player Leaderboard',exact:true}).locator('xpath=ancestor::div[@data-web-card][1]');
  await expect(board.getByText('Player A',{exact:true})).toBeVisible();
  await expect(board.getByText(draws===5?'—':'0%',{exact:true})).toBeVisible();
  await expect(board.getByText(draws===5?'0%':'—',{exact:true})).toHaveCount(0);
  await page.getByRole('tab',{name:/Decks/}).click();
  await expect(page.getByRole('heading',{name:'Deck Rankings',exact:true})).toBeVisible();
  const deck=page.getByText('Commander',{exact:true}).first().locator('xpath=ancestor::div[@data-web-card][1]');
  await expect(deck.getByText(draws===5?'—':'0%',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:/Meta/}).click();
  const pairs=page.getByRole('heading',{name:'Multicolor identities',exact:true}).locator('xpath=ancestor::div[@data-web-card][1]');
  await expect(pairs.getByText(draws===5?'—':'0%',{exact:true})).toBeVisible();
 });
}

test('arena report panels preserve retry, neutral draws, provisional decks and award switching', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  let valid = false;
  const image = 'https://cards.scryfall.io/normal/front/0/0/00000000-0000-4000-8000-000000000001.jpg';
  await page.route('**/cards.scryfall.io/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' }));
  await page.route('**/rest/v1/rpc/get_arena_analytics_bundle_v2', route => {
    if (!valid) return route.fulfill({ status: 503, json: { message: 'Synthetic report outage' } });
    const args = route.request().postDataJSON(), report = arenaReportFixture();
    report.groupId = args.p_group_id;
    report.filters = { since: args.p_since ?? null, until: args.p_until ?? null, bracket: args.p_bracket ?? null };
    report.commanders.forEach(row => { row.commander_image = image; });
    report.decks.forEach(row => { row.commander_image = image; });
    return route.fulfill({ status: 200, json: report });
  });
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
  await page.getByRole('tab', { name: /Decks/ }).click();
  const error = page.getByRole('alert').filter({ hasText: 'Statistics unavailable.' });
  await expect(error).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No deck stats yet', exact: true })).toHaveCount(0);
  valid = true; await error.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deck Rankings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show 1 decks under 5 games', exact: true }).click();
  await expect(page.getByText('Deck', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: /Players/ }).click();
  const board = page.getByRole('heading', { name: 'Player Leaderboard', exact: true }).locator('xpath=ancestor::div[@data-web-card][1]');
  await expect(board.getByText('Player A', { exact: true })).toBeVisible();
  await expect(board.getByText('50%', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Meta/ }).click();
  await expect(page.getByRole('heading', { name: 'Color meta', exact: true })).toBeVisible();
  await expect(page.getByText('No multicolor identities in the selected period.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Awards/ }).click();
  const awards = page.getByRole('tabpanel');
  await expect(awards.getByText('Executioner', { exact: true })).toBeVisible();
  await awards.getByRole('button', { name: 'Players', exact: true }).click();
  await expect(awards.getByText('Player A', { exact: true }).first()).toBeVisible();
  await awards.getByRole('button', { name: 'Decks', exact: true }).click();
  await expect(awards.getByText('Executioner', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Decks/ }).click();
  await expect(page.getByRole('button', { name: 'Hide decks under 5 games', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Deck', { exact: true }).first()).toBeVisible();
});
