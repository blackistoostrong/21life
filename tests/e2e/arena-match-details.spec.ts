import { test, expect, type Page } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { transitionFixtureSession } from './profile-auth-fixture';
import { seedArenaMatch } from './fixtures/arena-match';

async function openTrackedDetails(page: Page, fixture: Awaited<ReturnType<typeof seedArenaMatch>>, version = 2) {
  const tracked = await fixture.client.from('matches').update({ tracking_version: version }).eq('id', fixture.id);
  expect(tracked.error).toBeNull();
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${fixture.groupId}"]`).first().click();
  const note = page.getByText(fixture.notes, { exact: true }); await expect(note).toBeVisible();
  const button = note.locator('xpath=ancestor::div[.//button][1]').getByTitle('Tracking details', { exact: true });
  await button.click();
  await expect(page.getByRole('heading', { name: 'Match details', exact: true })).toBeVisible();
  return button;
}

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
    await openTrackedDetails(page, fixture);
    await expect.poll(() => started).toBe(1);
    if (departure === 'close') await page.getByRole('button', { name: 'Close', exact: true }).click();
    else if (departure === 'navigate') { await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/); }
    else await transitionFixtureSession(page, true);
    await expect.poll(() => aborted).toBe(1);
    release();
    await expect(page.getByRole('heading', { name: 'Match details', exact: true })).toHaveCount(0);
    await expect(page.getByText('Synthetic stale legacy recap', { exact: true })).toHaveCount(0);
    if (departure === 'account') {
      await transitionFixtureSession(page, false);
      await expect(page.getByRole('heading', { name: 'Match details', exact: true })).toHaveCount(0);
      expect(started).toBe(1);
    }
  } finally { release(); await fixture.cleanup(); }
});

test('arena match details current snapshots do not load legacy state', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedArenaMatch(); let requests = 0;
  await page.route('**/rest/v1/live_games?*', route => {
    if (new URL(route.request().url()).searchParams.get('match_id') === `eq.${fixture.id}`) requests++;
    return route.fallback();
  });
  try {
    await openTrackedDetails(page, fixture, 3);
    await expect(page.getByText('Loading recap…', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Final state', { exact: true })).toBeVisible();
    expect(requests).toBe(0);
  } finally { await fixture.cleanup(); }
});

test('arena match details legacy failures keep the historical snapshot fallback', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedArenaMatch(); let requests = 0;
  await page.route('**/rest/v1/live_games?*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('match_id') !== `eq.${fixture.id}`) return route.fallback();
    expect(url.searchParams.get('group_id')).toBe(`eq.${fixture.groupId}`);
    // A terminal read error isolates snapshot fallback from SDK GET retries.
    requests++; return route.fulfill({ status: 403, json: { code: '42501', message: 'Synthetic legacy failure' } });
  });
  try {
    await openTrackedDetails(page, fixture);
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByText('Loading recap…', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Final state', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Match details', exact: true })).toBeVisible();
  } finally { await fixture.cleanup(); }
});

test('arena match details repeated openings cancel old reads without stale loading', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedArenaMatch(); let requests = 0, aborted = 0;
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  let oldRequest: import('@playwright/test').Request | null = null;
  page.on('requestfailed', request => { if (request === oldRequest) aborted++; });
  await page.route('**/rest/v1/live_games?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('match_id') !== `eq.${fixture.id}`) return route.fallback();
    expect(url.searchParams.get('group_id')).toBe(`eq.${fixture.groupId}`);
    requests++;
    if (requests > 1) return route.fallback();
    oldRequest = route.request(); await waiting;
    await route.fulfill({ status: 503, json: { message: 'Synthetic old opening failure' } }).catch(() => {});
  });
  try {
    const open = await openTrackedDetails(page, fixture);
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByText('Loading recap…', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(() => aborted).toBe(1);
    await open.click(); await expect.poll(() => requests).toBe(2);
    await expect(page.getByText('Loading recap…', { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByText('Final state', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Match details', exact: true })).toBeVisible();
    expect(requests).toBe(2);
  } finally { release(); await fixture.cleanup(); }
});
