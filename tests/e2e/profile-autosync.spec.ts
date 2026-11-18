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
