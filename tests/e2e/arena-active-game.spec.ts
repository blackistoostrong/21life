import { test, expect } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { transitionFixtureSession } from './profile-auth-fixture';

for (const departure of ['navigate', 'account'] as const) test(`arena active game discovery cancels on ${departure}`, async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  let started = 0, aborted = 0;
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  const requests = new Set<import('@playwright/test').Request>();
  page.on('requestfailed', request => { if (requests.has(request)) aborted++; });
  await page.route('**/rest/v1/live_game_participants?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('group_id') !== `eq.${process.env.E2E_GROUP_ID!}`
      || url.searchParams.get('participant_key') !== `eq.user:${process.env.E2E_USER_ID!}`) return route.fallback();
    requests.add(route.request()); started++; await waiting;
    await route.fulfill({ status: 503, json: { message: 'Synthetic stale active-game discovery' } }).catch(() => {});
  });
  try {
    await fixtureLogin(page);
    await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
    await expect(page.getByRole('heading', { name: 'IMP synthetic playgroup', exact: true })).toBeVisible();
    await expect.poll(() => started).toBe(1);
    if (departure === 'navigate') { await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/); }
    else await transitionFixtureSession(page, true);
    await expect.poll(() => aborted).toBe(1);
    release();
    await expect(page.getByText('Synthetic stale active-game discovery', { exact: true })).toHaveCount(0);
  } finally { release(); }
});
