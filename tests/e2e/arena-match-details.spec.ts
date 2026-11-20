import { test, expect } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { transitionFixtureSession } from './profile-auth-fixture';
import { seedArenaMatch } from './fixtures/arena-match';

for (const departure of ['close', 'navigate', 'account'] as const) test(`arena match details legacy cancels on ${departure}`, async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedArenaMatch();
  let started = 0, aborted = 0;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const requests = new Set<import('@playwright/test').Request>();
  page.on('requestfailed', request => { if (requests.has(request)) aborted++; });
  await page.route('**/rest/v1/live_games?*', async route => {
    if (new URL(route.request().url()).searchParams.get('match_id') !== `eq.${fixture.id}`) return route.fallback();
    started++; requests.add(route.request()); await waiting;
    await route.fulfill({ status: 503, json: { message: 'Synthetic stale legacy recap' } }).catch(() => {});
  });
  try {
    const tracked = await fixture.client.from('matches').update({ tracking_version: 2 }).eq('id', fixture.id);
    expect(tracked.error).toBeNull();
    await fixtureLogin(page);
    await page.locator(`a[href="/table/${fixture.groupId}"]`).first().click();
    const note = page.getByText(fixture.notes, { exact: true }); await expect(note).toBeVisible();
    await note.locator('xpath=ancestor::div[.//button][1]').getByTitle('Tracking details', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Match details', exact: true })).toBeVisible();
    await expect.poll(() => started).toBe(1);
    if (departure === 'close') await page.getByRole('button', { name: 'Close', exact: true }).click();
    else if (departure === 'navigate') { await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/); }
    else await transitionFixtureSession(page, true);
    await expect.poll(() => aborted).toBe(1);
    release();
    await expect(page.getByRole('heading', { name: 'Match details', exact: true })).toHaveCount(0);
    await expect(page.getByText('Synthetic stale legacy recap', { exact: true })).toHaveCount(0);
  } finally { release(); await fixture.cleanup(); }
});
