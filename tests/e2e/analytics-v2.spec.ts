import { expect, test } from '@playwright/test';
import { analyticsDashboardFixture } from '../fixtures/analytics-dashboard';
import { fixtureLogin } from './fixture-login';

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
  await expect(section.getByText('50%',{ exact: true }).first()).toBeVisible();
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
    await page.getByRole('link',{ name: 'Open profile and decks' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect.poll(()=>cancelled).toBe(requests);
  } finally { releases.forEach(release=>release()); }
});
