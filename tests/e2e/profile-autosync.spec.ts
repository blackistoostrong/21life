import { expect, test } from '@playwright/test';
import { openPasswordFixture } from './profile-fixture';

for (const outcome of ['success', 'unavailable'] as const) {
  test(`profile Archidekt autosync ${outcome} preserves opt-in, ownership and silent background behavior`, async ({ page }) => {
    test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
    await openPasswordFixture(page);
    let reads = 0; let writes = 0; let reloads = 0;
    const image = 'https://cards.scryfall.io/art_crop/autosync-fixture.jpg';
    const deck = { name: 'Auto fixture', commander: 'Autosync Commander', commanderImageUrl: image,
      commanderOptions: [{ name: 'Autosync Commander', imageUrl: image, colorIdentity: ['U'] }],
      colorIdentity: ['U'], bracket: '3', sourceUrl: 'https://archidekt.com/decks/111111', sourceType: 'archidekt' };
    await page.route('https://cards.scryfall.io/**', route => route.fulfill({ status: 200,
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
    await page.route('https://api.scryfall.com/cards/named?*', route => route.fulfill({ status: 200,
      json: { object: 'card', name: 'Autosync Commander', cmc: 4 } }));
    await page.route('**/api/archidekt-user-decks', route => {
      expect(route.request().postDataJSON()).toEqual({ username: 'auto_owner' });
      reads += 1;
      return outcome === 'unavailable' ? route.fulfill({ status: 503, json: { error: 'Synthetic upstream unavailable' } })
        : route.fulfill({ status: 200, json: { decks: [deck, { ...deck, name: 'Second auto fixture', sourceUrl: 'https://archidekt.com/decks/222222' },
          { ...deck, sourceType: 'moxfield' }, { ...deck, warning: 'private' }, { ...deck, error: 'bad' },
          { ...deck, commander: ' ' }, { ...deck, sourceUrl: '' }] } });
    });
    await page.route('**/rest/v1/rpc/sync_archidekt_decks', route => {
      const rows = route.request().postDataJSON().p_decks;
      expect(rows).toHaveLength(2);
      for (const [index, row] of rows.entries()) expect(row).toMatchObject({ user_id: process.env.E2E_USER_ID,
        group_id: null, name: index ? 'Second auto fixture' : 'Auto fixture', commander: 'Autosync Commander',
        commander_image: image, source_type: 'archidekt', commander_cmc: 4, bracket: '3' });
      writes += 1;
      return route.fulfill({ status: 200, json: [] });
    });
    await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => {
      reloads += 1;
      return route.fulfill({ status: 200, json: { schemaVersion: 2, scope: 'personal', userId: process.env.E2E_USER_ID,
        revision: 'f'.repeat(32), total: 0, next: null, decks: [] } });
    });
    await page.route('**/rest/v1/profiles?*', route => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${process.env.E2E_USER_ID}`);
      expect(route.request().postDataJSON()).toEqual({ archidekt_username: 'auto_owner', archidekt_auto_import: true });
      return route.fulfill({ status: 204 });
    });
    expect(reads).toBe(0);
    await page.getByPlaceholder('Archidekt username', { exact: true }).fill('auto_owner');
    await page.getByRole('checkbox', { name: /Automatically import new decks/ }).check();
    await page.getByRole('button', { name: 'Save Archidekt', exact: true }).click();
    await expect(page.getByText('Archidekt configured', { exact: true })).toBeVisible();
    await expect.poll(() => reads).toBe(1);
    if (outcome === 'success') {
      await expect.poll(() => writes).toBe(1);
      await expect.poll(() => reloads).toBe(1);
    } else expect(writes).toBe(0);
    await expect(page.getByRole('heading', { name: 'account_fixture', exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic upstream unavailable', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Decks imported!', { exact: true })).toHaveCount(0);
    // Saving an identical opt-in must not trigger another check in this opening.
    await page.getByRole('button', { name: 'Save Archidekt', exact: true }).click();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(reads).toBe(1);
  });
}

for (const boundary of ['public catalog', 'commander metadata'] as const) {
  test(`profile Archidekt autosync cancels ${boundary} before a late private write across two openings`, async ({ page }) => {
    test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
    for (let opening = 0; opening < 2; opening++) {
      await openPasswordFixture(page);
      let pending = 0; let cancelled = 0; let writes = 0; let release!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      const name = `Autosync ${boundary} ${opening}`;
      const image = 'https://cards.scryfall.io/art_crop/autosync-cancel.jpg';
      const isBoundary = (url: string) => boundary === 'public catalog' ? url.includes('/api/archidekt-user-decks')
        : url.startsWith('https://api.scryfall.com/cards/named?');
      const failed = (request: import('@playwright/test').Request) => { if (isBoundary(request.url())) cancelled += 1; };
      page.on('requestfailed', failed);
      await page.route('https://api.scryfall.com/cards/named?*', async route => {
        if (boundary === 'commander metadata') { pending += 1; await wait; }
        await route.fulfill({ status: 200, json: { object: 'card', name, cmc: 4 } }).catch(() => {});
      });
      await page.route('**/api/archidekt-user-decks', async route => {
        if (boundary === 'public catalog') { pending += 1; await wait; }
        await route.fulfill({ status: 200, json: { decks: [{ name: 'Cancel auto fixture', commander: name,
          commanderImageUrl: image, commanderOptions: [{ name, imageUrl: image, colorIdentity: ['U'] }],
          colorIdentity: ['U'], sourceUrl: 'https://archidekt.com/decks/333333', sourceType: 'archidekt' }] } }).catch(() => {});
      });
      await page.route('**/rest/v1/rpc/sync_archidekt_decks', route => { writes += 1; return route.fulfill({ status: 200, json: [] }); });
      await page.route('**/rest/v1/profiles?*', route => route.request().method() === 'PATCH'
        ? route.fulfill({ status: 204 }) : route.fallback());
      try {
        await page.getByPlaceholder('Archidekt username', { exact: true }).fill('auto_owner');
        await page.getByRole('checkbox', { name: /Automatically import new decks/ }).check();
        await page.getByRole('button', { name: 'Save Archidekt', exact: true }).click();
        await expect.poll(() => pending).toBe(1);
        await page.getByRole('button', { name: 'Back to home', exact: true }).click();
        await expect(page).toHaveURL(/\/dashboard$/);
        await expect.poll(() => cancelled).toBe(1);
        release();
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        expect(writes).toBe(0);
        await expect(page.getByText('Decks imported!', { exact: true })).toHaveCount(0);
      } finally { release(); page.off('requestfailed', failed); }
    }
  });
}

test('profile Archidekt autosync cancels on opt-out and does not restart within the same opening', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  await openPasswordFixture(page);
  let reads = 0; let cancelled = 0; let writes = 0; let settingsWrites = 0; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  page.on('requestfailed', request => { if (request.url().includes('/api/archidekt-user-decks')) cancelled += 1; });
  await page.route('**/api/archidekt-user-decks', async route => {
    reads += 1; await wait;
    await route.fulfill({ status: 200, json: { decks: [] } }).catch(() => {});
  });
  await page.route('**/rest/v1/rpc/sync_archidekt_decks', route => { writes += 1; return route.fulfill({ status: 200, json: [] }); });
  await page.route('**/rest/v1/profiles?*', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    settingsWrites += 1; return route.fulfill({ status: 204 });
  });
  try {
    const automatic = page.getByRole('checkbox', { name: /Automatically import new decks/ });
    await page.getByPlaceholder('Archidekt username', { exact: true }).fill('auto_owner');
    await automatic.check();
    await page.getByRole('button', { name: 'Save Archidekt', exact: true }).click();
    await expect.poll(() => reads).toBe(1);
    await automatic.uncheck();
    await page.getByRole('button', { name: 'Save Archidekt', exact: true }).click();
    await expect.poll(() => settingsWrites).toBe(2);
    await expect.poll(() => cancelled).toBe(1);
    release();
    await automatic.check();
    await page.getByRole('button', { name: 'Save Archidekt', exact: true }).click();
    await expect.poll(() => settingsWrites).toBe(3);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(reads).toBe(1); expect(writes).toBe(0);
  } finally { release(); }
});
