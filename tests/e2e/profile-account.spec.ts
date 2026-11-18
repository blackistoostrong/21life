import { expect, test, type Page } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

async function openPasswordFixture(page: Page) {
  const userId = process.env.E2E_USER_ID!;
  let authorization = '';
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => {
    authorization = route.request().headers().authorization || '';
    return route.fulfill({ status: 200, json: { schemaVersion: 2, scope: 'personal', userId,
      revision: 'f'.repeat(32), total: 0, next: null, decks: [] } });
  });
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2', route => {
    const report = profileCatalogFixture(); report.userId = userId; report.total = 0; report.decks = [];
    return route.fulfill({ status: 200, json: report });
  });
  await page.route('**/rest/v1/profiles?*', route => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 403 });
    if (!new URL(route.request().url()).searchParams.get('select')?.includes('archidekt_last_sync_at')) return route.continue();
    return route.fulfill({ status: 200, json: [{ id: userId, username: 'account_fixture', display_name: null,
      archidekt_username: null, archidekt_auto_import: false, archidekt_last_sync_at: null }] });
  });
  await fixtureLogin(page);
  await page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true }).click();
  const card = page.locator('[data-web-card]').filter({ has: page.getByRole('button', { name: 'Nickname', exact: true }) });
  await expect(card.getByRole('heading', { name: 'account_fixture', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Password', exact: true }).click();
  return { card, authorization: () => authorization };
}

test('profile account preserves failed nickname/password drafts and validates before changing credentials', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const userId = process.env.E2E_USER_ID!;
  let nicknameAttempts = 0;
  let passwordVerifications = 0;
  let passwordUpdates = 0;
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => route.fulfill({ status: 200, json: {
    schemaVersion: 2, scope: 'personal', userId, revision: 'f'.repeat(32), total: 0, next: null, decks: [],
  } }));
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2', route => {
    const report = profileCatalogFixture(); report.userId = userId; report.total = 0; report.decks = [];
    return route.fulfill({ status: 200, json: report });
  });
  await page.route('**/rest/v1/profiles?*', route => {
    if (route.request().method() === 'PATCH') {
      expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${userId}`);
      expect(route.request().postDataJSON()).toEqual({ display_name: 'Account nickname fixture' });
      nicknameAttempts += 1;
      return nicknameAttempts === 1
        ? route.fulfill({ status: 503, json: { message: 'Synthetic nickname failure' } })
        : route.fulfill({ status: 204 });
    }
    const select = new URL(route.request().url()).searchParams.get('select');
    if (!select?.includes('archidekt_last_sync_at')) return route.continue();
    return route.fulfill({ status: 200, json: [{ id: userId, username: 'account_fixture', display_name: null,
      archidekt_username: null, archidekt_auto_import: false, archidekt_last_sync_at: null }] });
  });
  // No password update may reach Auth, even if the test catches a regression.
  await page.route('**/auth/v1/user*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    passwordUpdates += 1;
    return route.fulfill({ status: 400, json: { msg: 'Synthetic update denied' } });
  });
  await fixtureLogin(page);
  await page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true }).click();
  const card = page.locator('[data-web-card]').filter({ has: page.getByRole('button', { name: 'Nickname', exact: true }) });
  await expect(card.getByRole('heading', { name: 'account_fixture', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Nickname', exact: true }).click();
  const nickname = card.getByRole('textbox').first();
  await nickname.fill('  Account nickname fixture  ');
  await card.getByRole('button', { name: 'Save nickname', exact: true }).click();
  await expect.poll(() => nicknameAttempts).toBe(1);
  await expect(card.getByRole('button', { name: 'Save nickname', exact: true })).toBeEnabled();
  await expect(nickname).toHaveValue('  Account nickname fixture  ');
  await card.getByRole('button', { name: 'Save nickname', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Account nickname fixture', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Save nickname', exact: true })).toHaveCount(0);
  expect(nicknameAttempts).toBe(2);

  await card.getByRole('button', { name: 'Password', exact: true }).click();
  await card.getByLabel('Current password', { exact: true }).fill('WrongCurrent123');
  await card.getByLabel('New password', { exact: true }).fill('weak');
  await card.getByLabel('Confirm new password', { exact: true }).fill('weak');
  const update = card.getByRole('button', { name: 'Update password', exact: true });
  await expect(update).toBeDisabled();
  await card.getByLabel('New password', { exact: true }).fill('NewPassword123');
  await card.getByLabel('Confirm new password', { exact: true }).fill('Mismatch123');
  await expect(update).toBeDisabled();
  await expect(card.getByText('Passwords do not match.', { exact: true })).toBeVisible();
  await card.getByLabel('Confirm new password', { exact: true }).fill('NewPassword123');
  await page.route('**/auth/v1/token?grant_type=password', route => {
    passwordVerifications += 1;
    return route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Synthetic invalid credentials' } });
  });
  await update.click();
  await expect(page.getByText('Current password is incorrect.', { exact: true })).toBeVisible();
  await expect(update).toBeEnabled();
  await expect(card.getByLabel('Current password', { exact: true })).toHaveValue('WrongCurrent123');
  await expect(card.getByLabel('New password', { exact: true })).toHaveValue('NewPassword123');
  await expect(card.getByLabel('Confirm new password', { exact: true })).toHaveValue('NewPassword123');
  expect(passwordVerifications).toBe(1);
  expect(passwordUpdates).toBe(0);
});

test('profile password verification aborts when leaving the account', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  let requests = 0; let cancelled = 0; let writes = 0;
  const releases = new Set<() => void>();
  page.on('requestfailed', request => { if (request.url().includes('/auth/v1/token?grant_type=password')) cancelled += 1; });
  await page.route('**/auth/v1/user*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes += 1; return route.fulfill({ status: 400 });
  });
  const { card } = await openPasswordFixture(page);
  await page.route('**/auth/v1/token?grant_type=password', async route => {
    requests += 1;
    await new Promise<void>(resolve => releases.add(resolve));
    try { await route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Synthetic invalid credentials' } }); }
    catch (error) { if (cancelled === 0) throw error; }
  });
  try {
    await card.getByLabel('Current password', { exact: true }).fill('WrongCurrent123');
    await card.getByLabel('New password', { exact: true }).fill('NewPassword123');
    await card.getByLabel('Confirm new password', { exact: true }).fill('NewPassword123');
    await card.getByRole('button', { name: 'Update password', exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await expect(card.getByRole('button', { name: 'Updating...', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Back to home', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect.poll(() => cancelled).toBe(1);
    expect(writes).toBe(0);
  } finally { releases.forEach(release => release()); }
});

test('profile password change keeps the active session and revokes only temporary verification', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  let verificationToken = ''; let writes = 0; let originalSessionUsed = false; let cleanup = 0;
  let verifiedUser!: (value: object) => void;
  const userResponse = new Promise<object>(resolve => { verifiedUser = resolve; });
  page.on('response', response => {
    if (!response.url().includes('/auth/v1/token?grant_type=password') || response.status() !== 200) return;
    void response.json().then(data => { verificationToken = data.access_token; verifiedUser(data.user); }).catch(() => {});
  });
  const fixture = await openPasswordFixture(page);
  await page.route('**/auth/v1/user*', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes += 1;
    originalSessionUsed = route.request().headers().authorization === fixture.authorization();
    // Intercept every password write: the disposable user's actual password remains unchanged.
    return route.fulfill({ status: 200, json: await userResponse });
  });
  await page.route('**/auth/v1/logout?scope=local', route => {
    cleanup += 1;
    expect(route.request().headers().authorization === `Bearer ${verificationToken}`).toBe(true);
    return route.continue();
  });
  const cookies = async () => JSON.stringify((await page.context().cookies()).map(({ name, value }) => [name, value]).sort());
  const before = await cookies();
  await fixture.card.getByLabel('Current password', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await fixture.card.getByLabel('New password', { exact: true }).fill('NewPassword123');
  await fixture.card.getByLabel('Confirm new password', { exact: true }).fill('NewPassword123');
  await fixture.card.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.getByText('Password updated', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  expect(originalSessionUsed).toBe(true);
  // Compare booleans, so failed assertions never print tokens or cookie contents.
  expect((await cookies()) === before).toBe(true);
  await expect.poll(() => cleanup).toBe(1);
  await page.reload();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'account_fixture', exact: true })).toBeVisible();
});

test('profile nickname directory keeps the target and draft through an error and retry', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const userId = process.env.E2E_USER_ID!;
  const targetId = '00000000-0000-4000-8000-000000000002';
  let attempts = 0;
  await page.route('**/rest/v1/rpc/is_admin', route => route.fulfill({ status: 200, json: true }));
  await page.route('**/api/admin/profile-catalog*', route => route.fulfill({ status: 200, json: {
    schemaVersion: 2, scope: 'global', userId: null, revision: 'e'.repeat(32), total: 0, next: null, decks: [],
  } }));
  await page.route('**/api/admin/profile-analytics', route => route.fulfill({ status: 200,
    json: { ...profileCatalogFixture(), scope: 'global', userId: null, total: 0, decks: [] } }));
  await page.route('**/rest/v1/profiles?*', route => {
    if (route.request().method() === 'PATCH') {
      expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${targetId}`);
      expect(route.request().postDataJSON()).toEqual({ display_name: 'Target new' });
      attempts += 1;
      return attempts === 1 ? route.fulfill({ status: 503, json: { message: 'Synthetic nickname failure' } })
        : route.fulfill({ status: 204 });
    }
    if (!new URL(route.request().url()).searchParams.get('select')?.includes('archidekt_last_sync_at')) return route.continue();
    const profile = (id: string, username: string, display_name: string | null) => ({ id, username, display_name,
      archidekt_username: null, archidekt_auto_import: false, archidekt_last_sync_at: null });
    return route.fulfill({ status: 200, json: [profile(userId, 'account_fixture', null), profile(targetId, 'target_fixture', 'Target old')] });
  });
  await fixtureLogin(page);
  await page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Player nicknames', exact: true })).toBeVisible();
  const input = page.getByPlaceholder('target_fixture', { exact: true });
  const row = input.locator('xpath=..');
  await input.fill('  Target new  ');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => attempts).toBe(1);
  await expect(row.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(input).toHaveValue('  Target new  ');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.getByText('Target new', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('Target new');
  await expect(row.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(attempts).toBe(2);
  await expect(page.getByRole('heading', { name: 'account_fixture', exact: true })).toBeVisible();
});

test('profile nickname lifecycle cancels a pending save on navigation across two mounts', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const releases = new Set<() => void>();
  let pending = 0; let cancelled = 0;
  page.on('requestfailed', request => {
    if (request.method() === 'PATCH' && request.url().includes('/rest/v1/profiles?')) cancelled += 1;
  });
  const fixture = await openPasswordFixture(page);
  await page.route('**/rest/v1/profiles?*', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${process.env.E2E_USER_ID}`);
    pending += 1;
    await new Promise<void>(resolve => releases.add(resolve));
    await route.fulfill({ status: 204 }).catch(() => { /* Route may be closed during fixture teardown. */ });
  });
  try {
    for (let round = 1; round <= 2; round += 1) {
      if (round > 1) await page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true }).click();
      await fixture.card.getByRole('button', { name: 'Nickname', exact: true }).click();
      await fixture.card.getByRole('textbox').first().fill(`Pending nickname ${round}`);
      await fixture.card.getByRole('button', { name: 'Save nickname', exact: true }).click();
      await expect.poll(() => pending).toBe(round);
      await page.getByRole('button', { name: 'Back to home', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect.poll(() => cancelled).toBe(round);
    }
    await expect(page.getByText('Nickname updated', { exact: true })).toHaveCount(0);
  } finally { releases.forEach(release => release()); }
});

test('profile nickname lifecycle cancels pending directory loads on navigation across two mounts', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const releases = new Set<() => void>();
  let pending = 0; let cancelled = 0;
  page.on('requestfailed', request => {
    if (request.method() === 'GET' && new URL(request.url()).searchParams.get('select')?.includes('archidekt_last_sync_at')) cancelled += 1;
  });
  await openPasswordFixture(page);
  await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.route('**/rest/v1/profiles?*', async route => {
    if (!new URL(route.request().url()).searchParams.get('select')?.includes('archidekt_last_sync_at')) return route.fallback();
    pending += 1;
    await new Promise<void>(resolve => releases.add(resolve));
    await route.fulfill({ status: 200, json: [] }).catch(() => { /* Route may be closed during fixture teardown. */ });
  });
  try {
    for (let round = 1; round <= 2; round += 1) {
      const before = pending;
      await page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true }).click();
      await expect.poll(() => pending > before).toBe(true);
      await page.getByRole('button', { name: 'Back to home', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect.poll(() => cancelled === pending).toBe(true);
    }
  } finally { releases.forEach(release => release()); }
});

test('profile nickname lifecycle cancels saving when switching to the password panel', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  let pending = 0; let cancelled = 0; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  page.on('requestfailed', request => {
    if (request.method() === 'PATCH' && request.url().includes('/rest/v1/profiles?')) cancelled += 1;
  });
  const fixture = await openPasswordFixture(page);
  await page.route('**/rest/v1/profiles?*', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    pending += 1;
    await wait;
    await route.fulfill({ status: 204 }).catch(() => { /* Cancelled route may already be closed. */ });
  });
  try {
    await fixture.card.getByRole('button', { name: 'Nickname', exact: true }).click();
    const draft = fixture.card.getByRole('textbox').first();
    await draft.fill('Pending panel nickname');
    await fixture.card.getByRole('button', { name: 'Save nickname', exact: true }).click();
    await expect.poll(() => pending).toBe(1);
    await fixture.card.getByRole('button', { name: 'Password', exact: true }).click();
    await expect(fixture.card.getByLabel('Current password', { exact: true })).toBeVisible();
    await expect.poll(() => cancelled).toBe(1);
    release();
    await expect(page.getByText('Nickname updated', { exact: true })).toHaveCount(0);
    await fixture.card.getByRole('button', { name: 'Nickname', exact: true }).click();
    await expect(draft).toHaveValue('Pending panel nickname');
    await expect(fixture.card.getByRole('button', { name: 'Save nickname', exact: true })).toBeEnabled();
    expect(pending).toBe(1);
  } finally { release(); }
});
