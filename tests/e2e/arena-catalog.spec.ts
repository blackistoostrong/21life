import { expect, test } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { transitionFixtureSession } from './profile-auth-fixture';

for (const resource of ['metadata', 'guests'] as const) {
  test(`arena catalog cancels pending ${resource} on browser Back`, async ({ page }) => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    const groupId = process.env.E2E_GROUP_ID!;
    await fixtureLogin(page);
    let started = 0; let aborted = 0; let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const table = resource === 'metadata' ? 'groups' : 'arena_guests';
    const requests = new Set<import('@playwright/test').Request>();
    page.on('requestfailed', request => { if (requests.has(request)) aborted += 1; });
    await page.route(`**/rest/v1/${table}?*`, async route => {
      const query = new URL(route.request().url()).searchParams;
      if (query.get(resource === 'metadata' ? 'id' : 'group_id') !== `eq.${groupId}`) return route.fallback();
      requests.add(route.request()); started += 1; await pending;
      await route.fulfill({ status: 503, json: {} }).catch(() => { /* Disposed catalog request. */ });
    });
    try {
      await page.locator(`a[href="/table/${groupId}"]`).first().click();
      await expect.poll(() => started).toBeGreaterThan(0);
      await page.goBack();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect.poll(() => aborted).toBe(started);
    } finally { release(); }
  });
}

test('arena catalog releases queued member deck work before leaving the group', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  await page.addInitScript(() => {
    const probe = window as typeof window & { __arenaCatalogIdle?: number };
    const queue = new Set<number>(); let serial = 950_000;
    const request = window.requestIdleCallback.bind(window), cancel = window.cancelIdleCallback.bind(window);
    window.requestIdleCallback = (callback, options) => {
      if (options?.timeout !== 2500 && options?.timeout !== 8000) return request(callback, options);
      const id = ++serial; queue.add(id); probe.__arenaCatalogIdle = queue.size; return id;
    };
    window.cancelIdleCallback = id => {
      if (queue.delete(id)) probe.__arenaCatalogIdle = queue.size;
      else cancel(id);
    };
  });
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
  await expect(page.getByRole('button', { name: 'Back to home', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __arenaCatalogIdle?: number }).__arenaCatalogIdle ?? 0)).toBe(1);
  await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __arenaCatalogIdle?: number }).__arenaCatalogIdle ?? 0)).toBe(0);
});

for (const resource of ['group', 'guests', 'decks'] as const) {
  test(`arena catalog reports ${resource} failure and retries without inventing empty data`, async ({ page }) => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    await fixtureLogin(page);
    const groupId = process.env.E2E_GROUP_ID!;
    let fail = true; let fallbackReads = 0; let succeeded = 0;
    await page.route('**/rest/v1/decks?*', route => { fallbackReads += 1; return route.fallback(); });
    const path = resource === 'group' ? 'groups?*' : resource === 'guests' ? 'arena_guests?*' : 'rpc/get_arena_member_decks';
    page.on('response', response => {
      const url = new URL(response.url());
      if (!fail && response.ok() && url.pathname === `/rest/v1/${path.replace('?*', '')}`) succeeded += 1;
    });
    await page.route(`**/rest/v1/${path}`, route => fail
      ? route.fulfill({ status: 503, json: { code: 'XX000', message: 'Synthetic catalog failure' } }) : route.fallback());
    await page.locator(`a[href="/table/${groupId}"]`).first().click();
    const message = resource === 'group' ? 'Playgroup unavailable.' : resource === 'guests' ? 'Guests unavailable.' : 'Member decks unavailable.';
    if (resource === 'guests') await page.getByRole('tab', { name: /Players/ }).click();
    const alert = page.getByRole('alert').filter({ hasText: message });
    await expect(alert).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/table/${groupId}$`));
    if (resource === 'decks') expect(fallbackReads).toBe(0);
    fail = false;
    await alert.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => succeeded).toBeGreaterThan(0);
    await expect(alert).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back to home', exact: true })).toBeVisible();
    if (resource === 'guests') await expect(page.getByLabel('Search guest, deck or commander', { exact: true })).toBeVisible();
  });
}

test('arena catalog aborts previous account reads during a real Auth transition', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  await fixtureLogin(page);
  const groupId = process.env.E2E_GROUP_ID!;
  let started = 0; let aborted = 0; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests = new Set<import('@playwright/test').Request>();
  page.on('requestfailed', request => { if (requests.has(request)) aborted += 1; });
  await page.route('**/rest/v1/groups?*', async route => {
    const request = route.request();
    if (new URL(request.url()).searchParams.get('id') !== `eq.${groupId}`) return route.fallback();
    const jwt = request.headers().authorization?.split(' ')[1];
    const subject = jwt ? JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub : null;
    if (subject !== process.env.E2E_USER_ID) return route.fallback();
    requests.add(request); started += 1; await pending;
    await route.fulfill({ status: 503, json: {} }).catch(() => { /* Old account request disposed. */ });
  });
  try {
    await page.locator(`a[href="/table/${groupId}"]`).first().click();
    await expect.poll(() => started).toBeGreaterThan(0);
    await transitionFixtureSession(page, true);
    await expect(page.getByRole('button', { name: 'Back to home', exact: true })).toBeVisible();
    await expect.poll(() => aborted).toBe(started);
    release();
    await expect(page.getByRole('alert').filter({ hasText: 'Playgroup unavailable.' })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/table/${groupId}$`));
  } finally { release(); }
});

test('arena catalog cancels pending member decks on browser Back', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  await fixtureLogin(page);
  let started = 0; let aborted = 0; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  page.on('requestfailed', request => { if (request.url().endsWith('/rest/v1/rpc/get_arena_member_decks')) aborted += 1; });
  await page.route('**/rest/v1/rpc/get_arena_member_decks', async route => {
    started += 1; await pending;
    await route.fulfill({ status: 503, json: {} }).catch(() => { /* Catalog disposed. */ });
  });
  try {
    await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
    await expect.poll(() => started).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Back to home', exact: true }).click();
    await expect.poll(() => aborted).toBe(started);
  } finally { release(); }
});
