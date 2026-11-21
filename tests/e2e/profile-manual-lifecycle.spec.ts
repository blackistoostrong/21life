import { expect, test } from '@playwright/test';
import { commander, openProfileSaveFixture } from './profile-save-fixture';
import { transitionFixtureSession } from './profile-auth-fixture';

test('profile manual draft cancels pending commander art on Back across two openings', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  for (let opening = 0; opening < 2; opening++) {
    let pending = 0; let cancelled = 0; let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    await openProfileSaveFixture(page, 'manual', false, async route => {
      pending += 1; await wait;
      await route.fulfill({ status: 200, json: { data: [] } }).catch(() => {});
    });
    const failed = (request: import('@playwright/test').Request) => {
      if (request.url().startsWith('https://api.scryfall.com/cards/search?')) cancelled += 1;
    };
    page.on('requestfailed', failed);
    try {
      await expect.poll(() => pending).toBe(1);
      await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
      await expect.poll(() => cancelled).toBe(1);
      release();
      await expect(page.getByRole('dialog').getByPlaceholder('Search commander by name...', { exact: true })).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    } finally { release(); page.off('requestfailed', failed); }
  }
});

test('profile manual draft account switch removes the old commander, name and pending art', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  let pending = 0; let cancelled = 0; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await openProfileSaveFixture(page, 'manual', false, async route => {
    pending += 1; await wait;
    await route.fulfill({ status: 200, json: { data: [] } }).catch(() => {});
  });
  page.on('requestfailed', request => { if (request.url().startsWith('https://api.scryfall.com/cards/search?')) cancelled += 1; });
  try {
    await expect.poll(() => pending).toBe(1);
    await transitionFixtureSession(page, true);
    await expect.poll(() => cancelled).toBe(1);
    await expect(page.getByRole('dialog').getByPlaceholder('Search commander by name...', { exact: true })).toHaveValue('');
    await expect(page.getByRole('dialog').getByText(commander, { exact: true })).toHaveCount(0);
    release();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('dialog').getByText(commander, { exact: true })).toHaveCount(0);
  } finally { release(); }
});

test('profile manual save keeps its submitted art while optional printings finish during a write', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  let pending = 0; let writes = 0; let cancelled = 0;
  let releaseArt!: () => void; let releaseWrite!: () => void;
  const artWait = new Promise<void>(resolve => { releaseArt = resolve; });
  const writeWait = new Promise<void>(resolve => { releaseWrite = resolve; });
  const save = await openProfileSaveFixture(page, 'manual', false, async route => {
    pending += 1; await artWait;
    await route.fulfill({ status: 200, json: { data: [{ id: 'later-print', name: commander,
      image_uris: { art_crop: '/favicon.ico?later-print' }, set_name: 'Later printing', collector_number: '1' }] } }).catch(() => {});
  });
  page.on('requestfailed', request => { if (/\/rest\/v1\/decks(?:\?|$)/.test(request.url())) cancelled += 1; });
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    expect(route.request().postDataJSON().commander_image).toContain('save-preview');
    writes += 1; await writeWait;
    await route.fulfill({ status: 201, json: [] }).catch(() => {});
  });
  try {
    await expect.poll(() => pending).toBe(1);
    await save.click();
    await expect.poll(() => writes).toBe(1);
    await expect(page.getByRole('dialog').getByPlaceholder(commander, { exact: true })).toBeDisabled();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true })).toBeEnabled();
    releaseArt();
    await expect(page.getByRole('dialog').getByText('Later printing', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByAltText(commander, { exact: true }).first()).toHaveAttribute('src', /save-preview/);
    expect(cancelled).toBe(0);
    releaseWrite();
    await expect(page.getByText('Deck created!', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toBe(1);
  } finally { releaseArt(); releaseWrite(); }
});
