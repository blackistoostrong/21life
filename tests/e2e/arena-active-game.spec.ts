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
    await expect.poll(() => started).toBeGreaterThan(0);
    await expect.poll(() => started - aborted).toBe(1);
    if (departure === 'navigate') { await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/); }
    else await transitionFixtureSession(page, true);
    await expect.poll(() => aborted).toBe(started);
    release();
    await expect(page.getByText('Synthetic stale active-game discovery', { exact: true })).toHaveCount(0);
  } finally { release(); }
});

test('arena active game discovery shares one pending read across focus events and stops after unmount', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  await page.addInitScript(({ groupId, actorId }) => {
    const monitor = window as typeof window & { arenaActiveFetches: number };
    monitor.arenaActiveFetches = 0;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname.endsWith('/live_game_participants') && url.searchParams.get('group_id') === `eq.${groupId}`
        && url.searchParams.get('participant_key') === `eq.user:${actorId}`) monitor.arenaActiveFetches++;
      return original(input, init);
    };
  }, { groupId: process.env.E2E_GROUP_ID!, actorId: process.env.E2E_USER_ID! });
  let started = 0, aborted = 0;
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  const requests = new Set<import('@playwright/test').Request>();
  page.on('requestfailed', request => { if (requests.has(request)) aborted++; });
  await page.route('**/rest/v1/live_game_participants?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('group_id') !== `eq.${process.env.E2E_GROUP_ID!}`
      || url.searchParams.get('participant_key') !== `eq.user:${process.env.E2E_USER_ID!}`) return route.fallback();
    requests.add(route.request()); started++; await waiting;
    await route.fulfill({ status: 503, json: { message: 'Synthetic pending focus read' } }).catch(() => {});
  });
  const count = () => page.evaluate(() => (window as typeof window & { arenaActiveFetches: number }).arenaActiveFetches);
  const focus = () => page.evaluate(async () => {
    const visibility = document.visibilityState;
    window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return visibility;
  });
  try {
    await fixtureLogin(page);
    await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
    await expect(page.getByRole('heading', { name: 'IMP synthetic playgroup', exact: true })).toBeVisible();
    await expect.poll(() => started - aborted).toBe(1);
    const before = await count(); expect(await focus()).toBe('visible');
    expect(await count()).toBe(before);
    await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/);
    await expect.poll(() => aborted).toBe(started);
    const after = await count(); expect(await focus()).toBe('visible'); expect(await count()).toBe(after);
    release();
  } finally { release(); }
});
