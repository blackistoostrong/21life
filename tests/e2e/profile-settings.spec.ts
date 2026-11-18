import { expect, test } from '@playwright/test';
import { openPasswordFixture } from './profile-fixture';

test('profile Archidekt settings preserve an active import and reset it to the latest saved default on close', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  await openPasswordFixture(page);
  let saves = 0; let reads = 0;
  let releaseSave!: () => void; let releaseImport!: () => void;
  const saveWait = new Promise<void>(resolve => { releaseSave = resolve; });
  const importWait = new Promise<void>(resolve => { releaseImport = resolve; });
  await page.route('**/rest/v1/profiles?*', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${process.env.E2E_USER_ID}`);
    expect(route.request().postDataJSON()).toEqual({ archidekt_username: 'saved_owner', archidekt_auto_import: false });
    saves += 1; await saveWait;
    await route.fulfill({ status: 204 }).catch(() => {});
  });
  await page.route('**/api/archidekt-user-decks', async route => {
    expect(route.request().postDataJSON()).toEqual({ username: 'public_draft' });
    reads += 1; await importWait;
    await route.fulfill({ status: 200, json: { decks: [] } }).catch(() => {});
  });
  try {
    await page.getByPlaceholder('Archidekt username', { exact: true }).fill('saved_owner');
    await page.getByRole('button', { name: 'Save Archidekt', exact: true }).click();
    await expect.poll(() => saves).toBe(1);
    await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
    await page.getByRole('button', { name: /^Import by Archidekt username/ }).click();
    const input = page.getByRole('dialog').getByPlaceholder('Archidekt username', { exact: true });
    await input.fill('public_draft');
    await page.getByRole('button', { name: 'Load Decks', exact: true }).click();
    await expect.poll(() => reads).toBe(1);
    releaseSave();
    await expect(page.getByText('Archidekt configured', { exact: true })).toHaveCount(1);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(input).toHaveValue('public_draft');
    await expect(input).toBeDisabled();
    releaseImport();
    await expect(page.getByText('No public decks found', { exact: true })).toHaveCount(1);
    await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
    await page.getByRole('button', { name: /^Import by Archidekt username/ }).click();
    await expect(input).toHaveValue('saved_owner');
    expect(saves).toBe(1); expect(reads).toBe(1);
  } finally { releaseSave(); releaseImport(); }
});

test('profile Archidekt settings validate, retain failed drafts and prefill username import after retry', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  let attempts = 0; let backgroundReads = 0;
  await openPasswordFixture(page);
  await page.route('**/rest/v1/profiles?*', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${process.env.E2E_USER_ID}`);
    expect(route.request().postDataJSON()).toEqual({ archidekt_username: 'public_owner', archidekt_auto_import: true });
    attempts += 1;
    return attempts === 1 ? route.fulfill({ status: 503, json: { message: 'Synthetic settings failure' } })
      : route.fulfill({ status: 204 });
  });
  await page.route('**/api/archidekt-user-decks', route => {
    expect(route.request().postDataJSON()).toEqual({ username: 'public_owner' });
    backgroundReads += 1; return route.fulfill({ status: 200, json: { decks: [] } });
  });
  const input = page.getByPlaceholder('Archidekt username', { exact: true });
  const automatic = page.getByRole('checkbox', { name: /Automatically import new decks/ });
  const save = page.getByRole('button', { name: 'Save Archidekt', exact: true });
  await automatic.check();
  await save.click();
  await expect(page.getByText('Username required', { exact: true })).toBeVisible();
  expect(attempts).toBe(0);
  await input.fill('  public_owner  ');
  await save.click();
  await expect(page.getByText('Synthetic settings failure', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('  public_owner  ');
  await expect(automatic).toBeChecked();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Archidekt configured', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('public_owner');
  await expect.poll(() => backgroundReads).toBe(1);
  await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
  await page.getByRole('button', { name: /^Import by Archidekt username/ }).click();
  await expect(page.getByRole('dialog').getByPlaceholder('Archidekt username', { exact: true })).toHaveValue('public_owner');
  expect(attempts).toBe(2);
});

test('profile Archidekt settings keep a dirty draft after an unrelated nickname update', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const fixture = await openPasswordFixture(page);
  await page.route('**/rest/v1/profiles?*', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    expect(route.request().postDataJSON()).toEqual({ display_name: 'New fixture nickname' });
    return route.fulfill({ status: 204 });
  });
  const settings = page.getByPlaceholder('Archidekt username', { exact: true });
  await settings.fill('settings_draft');
  await fixture.card.getByRole('button', { name: 'Nickname', exact: true }).click();
  await fixture.card.getByPlaceholder('account_fixture', { exact: true }).fill('New fixture nickname');
  await fixture.card.getByRole('button', { name: 'Save nickname', exact: true }).click();
  await expect(fixture.card.getByRole('heading', { name: 'New fixture nickname', exact: true })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(settings).toHaveValue('settings_draft');
});

test('profile Archidekt settings do not overwrite a public import draft after delayed nickname acknowledgment', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const fixture = await openPasswordFixture(page);
  let pending = 0; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/profiles?*', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    expect(route.request().postDataJSON()).toEqual({ display_name: 'Late fixture nickname' });
    pending += 1; await wait;
    await route.fulfill({ status: 204 }).catch(() => {});
  });
  try {
    await fixture.card.getByRole('button', { name: 'Nickname', exact: true }).click();
    await fixture.card.getByPlaceholder('account_fixture', { exact: true }).fill('Late fixture nickname');
    await fixture.card.getByRole('button', { name: 'Save nickname', exact: true }).click();
    await expect.poll(() => pending).toBe(1);
    await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
    await page.getByRole('button', { name: /^Import by Archidekt username/ }).click();
    const input = page.getByRole('dialog').getByPlaceholder('Archidekt username', { exact: true });
    await input.fill('public_draft');
    release();
    await expect(page.getByRole('heading', { name: 'Late fixture nickname', exact: true, includeHidden: true })).toHaveCount(1);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(input).toHaveValue('public_draft');
  } finally { release(); }
});

test('profile Archidekt settings cancel a pending save when leaving without late feedback', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  await openPasswordFixture(page);
  let pending = 0; let cancelled = 0; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  page.on('requestfailed', request => {
    if (request.method() === 'PATCH' && request.url().includes('/rest/v1/profiles?')) cancelled += 1;
  });
  await page.route('**/rest/v1/profiles?*', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    pending += 1; await wait;
    await route.fulfill({ status: 204 }).catch(() => {});
  });
  try {
    await page.getByPlaceholder('Archidekt username', { exact: true }).fill('public_owner');
    await page.getByRole('button', { name: 'Save Archidekt', exact: true }).click();
    await expect.poll(() => pending).toBe(1);
    await expect(page.getByPlaceholder('Archidekt username', { exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: /Automatically import new decks/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Saving...', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Back to home', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect.poll(() => cancelled).toBe(1);
    release();
    await expect(page.getByText('Archidekt configured', { exact: true })).toHaveCount(0);
  } finally { release(); }
});
