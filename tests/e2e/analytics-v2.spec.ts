import { expect, test } from '@playwright/test';
import { analyticsDashboardFixture } from '../fixtures/analytics-dashboard';
import { fixtureLogin } from './fixture-login';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

test('analytics v2 refuses incomplete data and retries without a facts fallback',async({ page })=>{
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1','Requires a disposable authenticated backend.');
  let valid=false;
  const legacyCalls: string[]=[];
  page.on('request',request=>{ if (/\/rpc\/get_(personal|global)_analytics_facts/.test(request.url())) legacyCalls.push(request.url()); });
  await page.route('**/rest/v1/rpc/get_personal_analytics_dashboard_v2',route=>route.fulfill({
    status: 200,json: { ...analyticsDashboardFixture(),schemaVersion: valid ? 2 : 1 },
  }));
  await fixtureLogin(page);
  await expect(page.getByText('Statistics unavailable. Partial results are not displayed.',{ exact: true })).toBeVisible();
  await expect(page.getByRole('heading',{ name: 'No personal data yet',exact: true })).toHaveCount(0);
  valid=true;
  await page.getByRole('button',{ name: 'Retry',exact: true }).click();
  const section=page.getByRole('heading',{ name: 'Personal Analytics',exact: true }).locator('xpath=ancestor::section[1]');
  await expect(section.getByText('50% win',{ exact: true })).toBeVisible();
  await expect(page.getByText('Statistics unavailable. Partial results are not displayed.',{ exact: true })).toHaveCount(0);
  expect(legacyCalls).toEqual([]);
});

test('analytics v2 cancels its owned request when navigating away',async({ page })=>{
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1','Requires a disposable authenticated backend.');
  let requests=0;
  let cancelled=0;
  const releases=new Set<()=>void>();
  page.on('requestfailed',request=>{ if (request.url().includes('/rpc/get_personal_analytics_dashboard_v2')) cancelled+=1; });
  await page.route('**/rest/v1/rpc/get_personal_analytics_dashboard_v2',async route=>{
    requests+=1;
    await new Promise<void>(resolve=>releases.add(resolve));
    try { await route.fulfill({ status: 200,json: analyticsDashboardFixture() }); }
    catch(error) { if (cancelled===0) throw error; }
  });
  try {
    await fixtureLogin(page);
    await expect.poll(()=>requests).toBeGreaterThan(0);
    await page.getByRole('banner').getByRole('button',{ name: 'Profile',exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect.poll(()=>cancelled).toBe(requests);
  } finally { releases.forEach(release=>release()); }
});

test('profile v2 reports backend errors and retries with neutral draws',async({page})=>{
  test.skip(process.env.E2E_ANALYTICS_FLOW!=='1','Requires disposable authentication.');
  const userId=process.env.E2E_USER_ID!;
  const deckId='00000000-0000-4000-8000-000000000001';
  let valid=false;const legacy:string[]=[];
  page.on('request',request=>{
    if(/\/rest\/v1\/match_participants\?/.test(request.url()) || /\/rpc\/get_profile_deck_performance$/.test(request.url())) legacy.push(request.url());
  });
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2',route=>route.fulfill({status:200,json:{
    schemaVersion:2,scope:'personal',userId,revision:'a'.repeat(32),total:1,next:null,
    decks:[{id:deckId,user_id:userId,group_id:null,name:'DEV26 profile metric fixture',commander:'Atraxa, Praetors’ Voice',
      commander_image:'https://cards.scryfall.io/normal/front/0/0/00000000-0000-4000-8000-000000000001.jpg',
      commander_cmc:4,commander_options:[],color_identity:['W','U','B','G'],bracket:'3',source_type:'manual',source_url:null,
      is_favorite:false,is_archived:false,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}],
  }}));
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2',route=>{
    const report=profileCatalogFixture();report.userId=userId;report.decks[0].deck_id=deckId;
    return route.fulfill({status:200,json:{...report,complete:valid}});
  });
  await fixtureLogin(page);
  await page.getByRole('banner').getByRole('button',{name:'Profile',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Statistics unavailable.'})).toBeVisible();
  const card=page.getByRole('region',{name:'Your player card'});
  await expect(card.getByText('—',{exact:true})).toHaveCount(2);
  valid=true;
  await page.getByRole('alert').filter({hasText:'Statistics unavailable.'}).getByRole('button',{name:'Retry',exact:true}).click();
  await expect(card.getByText('50%',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText:'Statistics unavailable.'})).toHaveCount(0);
  expect(legacy).toEqual([]);
  await page.getByRole('button',{name:'Details',exact:true}).click();
  const chart=page.getByRole('img',{name:'Wins 1, draws 1, losses 1. Win rate 50%.',exact:true});
  await expect(chart).toBeVisible();
  await expect(chart.locator('.recharts-pie-sector')).toHaveCount(3);
  const sectors=await chart.locator('.recharts-sector').evaluateAll(elements=>elements.map(element=>({
    fill:element.getAttribute('fill'),path:element.getAttribute('d'),
  })));
  expect(sectors.map(sector=>sector.fill)).toEqual(['#34d399','#22d3ee','#64748b']);
  expect(sectors.every(sector=>sector.path&&!/NaN|Infinity/.test(sector.path))).toBe(true);
  await chart.screenshot({path:`artifacts/dev26/recharts-profile-${test.info().project.name}.png`});
});
