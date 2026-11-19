import { expect, test } from '@playwright/test';
import { commander, openProfileSaveFixture } from './profile-save-fixture';
import { transitionFixtureSession } from './profile-auth-fixture';

test('profile persistence optional art acknowledgment preserves the submitted choice and active write', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  let artReads = 0; let writes = 0; let cancelled = 0;
  let releaseArt!: () => void; let releaseWrite!: () => void;
  const artWait = new Promise<void>(resolve => { releaseArt = resolve; });
  const writeWait = new Promise<void>(resolve => { releaseWrite = resolve; });
  const save = await openProfileSaveFixture(page, 'URL', false, async route => {
    artReads += 1; await artWait;
    await route.fulfill({ status: 200, json: { data: [] } }).catch(() => {});
  });
  page.on('requestfailed', request => { if (/\/rest\/v1\/decks(?:\?|$)/.test(request.url())) cancelled += 1; });
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    writes += 1; await writeWait;
    await route.fulfill({ status: 201, json: [] }).catch(() => {});
  });
  try {
    await expect.poll(() => artReads).toBe(1);
    await save.click();
    await expect.poll(() => writes).toBe(1);
    releaseArt();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(cancelled).toBe(0);
    releaseWrite();
    await expect(page.getByText('Deck added!', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toBe(1);
  } finally { releaseArt(); releaseWrite(); }
});

for (const source of ['URL', 'manual', 'bulk'] as const) {
  for (const boundary of ['metadata', 'write'] as const) {
    test(`profile persistence ${source} cancels pending ${boundary} on preview discard across two openings`, async ({ page }) => {
      test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
      for (let opening = 0; opening < 2; opening++) {
        const save = await openProfileSaveFixture(page, source);
        let pending = 0; let cancelled = 0; let writes = 0; let release!: () => void;
        const wait = new Promise<void>(resolve => { release = resolve; });
        const isBoundary = (url: string) => boundary === 'metadata' ? url.startsWith('https://api.scryfall.com/cards/named?')
          : source === 'bulk' ? url.includes('/rpc/sync_archidekt_decks') : /\/rest\/v1\/decks(?:\?|$)/.test(url);
        const failed = (request: import('@playwright/test').Request) => { if (isBoundary(request.url())) cancelled += 1; };
        page.on('requestfailed', failed);
        await page.route('https://api.scryfall.com/cards/named?*', async route => {
          if (boundary === 'metadata') { pending += 1; await wait; }
          await route.fulfill({ status: 200, json: { object: 'card', name: commander, cmc: 4 } }).catch(() => {});
        });
        const privateWrite = async (route: import('@playwright/test').Route) => {
          writes += 1;
          if (boundary === 'write') { pending += 1; await wait; }
          await route.fulfill({ status: 200, json: [] }).catch(() => {});
        };
        await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => route.request().method() === 'POST' ? privateWrite(route) : route.fallback());
        await page.route('**/rest/v1/rpc/sync_archidekt_decks', privateWrite);
        try {
          await save.click();
          await expect.poll(() => pending).toBe(1);
          await page.getByRole('dialog').getByRole('button', { name: source === 'URL' ? 'Cancel' : 'Back', exact: true }).click();
          await expect.poll(() => cancelled).toBe(1);
          release();
          await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
          await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
          await page.getByRole('button', { name: 'Back to home', exact: true }).click();
          await expect(page).toHaveURL(/\/dashboard$/);
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          expect(writes).toBe(boundary === 'metadata' ? 0 : 1);
          await expect(page.getByText(/^(Deck added!|Deck created!|Decks imported!)$/)).toHaveCount(0);
        } finally { release(); page.off('requestfailed', failed); }
      }
    });
  }
}

test('profile persistence bulk locks before metadata and rejects a synchronous double submission', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const save = await openProfileSaveFixture(page, 'bulk');
  let pending = 0; let writes = 0; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://api.scryfall.com/cards/named?*', async route => {
    pending += 1; await wait;
    await route.fulfill({ status: 200, json: { object: 'card', name: commander, cmc: 4 } }).catch(() => {});
  });
  await page.route('**/rest/v1/rpc/sync_archidekt_decks', route => { writes += 1; return route.fulfill({ status: 200, json: [] }); });
  try {
    await save.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect.poll(() => pending).toBe(1);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Saving...', exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toBe(1);
  } finally { release(); }
});

test('profile persistence account switch cancels an old overwrite decision before any private write', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const save = await openProfileSaveFixture(page, 'URL', true);
  let writes = 0;
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => {
    if (!['POST', 'PATCH'].includes(route.request().method())) return route.fallback();
    writes += 1; return route.fulfill({ status: 200, json: [] });
  });
  await save.click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await transitionFixtureSession(page, true);
  await expect(page.getByRole('heading', { name: 'No decks yet', exact: true, includeHidden: true })).toHaveCount(1);
  await expect(page.getByRole('alertdialog', { includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Import Deck', exact: true })).toBeVisible();
  expect(writes).toBe(0);
});
