import { expect, test } from '@playwright/test';
import { openPasswordFixture } from './profile-fixture';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

test('profile URL import preserves a failed draft and retries to a preview without saving a deck', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const url = 'https://archidekt.com/decks/123456';
  const image = 'https://cards.scryfall.io/art_crop/import-preview.jpg';
  let attempts = 0; let writes = 0;
  await page.route('**/api/deck-import', route => {
    expect(route.request().postDataJSON()).toEqual({ url });
    attempts += 1;
    return attempts === 1 ? route.fulfill({ status: 503, json: { error: 'Synthetic import unavailable' } })
      : route.fulfill({ status: 200, json: { name: 'Imported fixture', commander: 'Imported commander',
        commanderImageUrl: image, commanderOptions: [{ name: 'Imported commander', imageUrl: image, colorIdentity: ['U'] }],
        colorIdentity: ['U'], bracket: '3', sourceUrl: url, sourceType: 'archidekt' } });
  });
  await page.route('https://api.scryfall.com/cards/search?*', route => route.fulfill({ status: 200, json: { data: [] } }));
  await page.route('**/api/scryfall-card-arts?*', route => route.fulfill({ status: 200, json: { data: [] } }));
  await page.route('**/api/edhrec-*', route => route.fulfill({ status: 404, json: {} }));
  await page.route('https://cards.scryfall.io/**', route => route.fulfill({ status: 200,
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
  await page.route('**/rest/v1/decks?*', route => {
    if (route.request().method() !== 'POST' && route.request().method() !== 'PATCH') return route.continue();
    writes += 1; return route.fulfill({ status: 403 });
  });
  await openPasswordFixture(page);
  await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
  await page.getByRole('button', { name: /^Import from URL/ }).click();
  const input = page.getByPlaceholder('https://archidekt.com/decks/123456 o https://www.moxfield.com/decks/...', { exact: true });
  await input.fill(url);
  await page.getByRole('button', { name: 'Import Deck', exact: true }).click();
  await expect(page.getByText('Synthetic import unavailable', { exact: true })).toBeVisible();
  await expect(input).toHaveValue(url);
  await expect(page.getByRole('button', { name: 'Import Deck', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Import Deck', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Imported fixture', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Deck', exact: true })).toBeEnabled();
  expect(attempts).toBe(2); expect(writes).toBe(0);
});

test('profile Archidekt import preserves failed username and selects only usable previews', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  let attempts = 0; let writes = 0;
  const image = 'https://cards.scryfall.io/art_crop/bulk-preview.jpg';
  await page.route('**/api/archidekt-user-decks', route => {
    expect(route.request().postDataJSON()).toEqual({ username: 'public_fixture' });
    attempts += 1;
    return attempts === 1 ? route.fulfill({ status: 503, json: { error: 'Synthetic public catalog failure' } })
      : route.fulfill({ status: 200, json: { decks: [
        { name: 'Public preview fixture', commander: 'Public commander', commanderImageUrl: image,
          commanderOptions: [{ name: 'Public commander', imageUrl: image, colorIdentity: ['U'] }],
          colorIdentity: ['U'], bracket: '3', sourceUrl: 'https://archidekt.com/decks/123456', sourceType: 'archidekt' },
        { name: 'Unusable preview', sourceUrl: '', sourceType: 'archidekt' },
      ] } });
  });
  await page.route('https://cards.scryfall.io/**', route => route.fulfill({ status: 200,
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
  await page.route('**/rest/v1/decks?*', route => {
    if (route.request().method() !== 'POST' && route.request().method() !== 'PATCH') return route.continue();
    writes += 1; return route.fulfill({ status: 403 });
  });
  await openPasswordFixture(page);
  await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
  await page.getByRole('button', { name: /^Import by Archidekt username/ }).click();
  const input = page.getByRole('dialog').getByPlaceholder('Archidekt username', { exact: true });
  await input.fill('public_fixture');
  await page.getByRole('button', { name: 'Load Decks', exact: true }).click();
  await expect(page.getByText('Synthetic public catalog failure', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('public_fixture');
  await page.getByRole('button', { name: 'Load Decks', exact: true }).click();
  await expect(page.getByText('Public preview fixture', { exact: true })).toBeVisible();
  await expect(page.getByText('Unusable preview', { exact: true })).toHaveCount(0);
  await expect(page.getByText('1/1 deck selected', { exact: true })).toBeVisible();
  const save = page.getByRole('button', { name: 'Save Decks', exact: true });
  await expect(save).toBeEnabled();
  await page.getByRole('dialog').getByRole('button', { name: 'None', exact: true }).click();
  await expect(save).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'All', exact: true }).click();
  await expect(save).toBeEnabled();
  expect(attempts).toBe(2); expect(writes).toBe(0);
});

for (const source of ['URL', 'Archidekt'] as const) {
  for (const action of ['close', 'leave'] as const) {
    test(`profile ${source} import cancels a pending request on ${action} across two openings`, async ({ page }) => {
      test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
      const endpoint = source === 'URL' ? '/api/deck-import' : '/api/archidekt-user-decks';
      const url = 'https://archidekt.com/decks/123456';
      let pending = 0; let cancelled = 0;
      const releases = new Set<() => void>();
      const deck = { name: 'Late imported preview', commander: 'Public commander', commanderImageUrl: '/favicon.ico',
        commanderOptions: [{ name: 'Public commander', imageUrl: '/favicon.ico', colorIdentity: ['U'] }],
        colorIdentity: ['U'], bracket: '3', sourceUrl: url, sourceType: 'archidekt' };
      page.on('requestfailed', request => { if (new URL(request.url()).pathname === endpoint) cancelled += 1; });
      await page.route(`**${endpoint}`, async route => {
        pending += 1;
        await new Promise<void>(resolve => releases.add(resolve));
        await route.fulfill({ status: 200, json: source === 'URL' ? deck : { decks: [deck] } })
          .catch(() => { /* Cancellation can close the intercepted route. */ });
      });
      await page.route('https://api.scryfall.com/cards/**', route => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/scryfall-card-arts?*', route => route.fulfill({ status: 200, json: { data: [] } }));
      await openPasswordFixture(page);
      try {
        for (let round = 1; round <= 2; round += 1) {
          if (round > 1 && action === 'leave') {
            await page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true }).click();
          }
          await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
          await page.getByRole('button', { name: source === 'URL' ? /^Import from URL/ : /^Import by Archidekt username/ }).click();
          const dialog = page.getByRole('dialog');
          if (source === 'URL') {
            await dialog.getByPlaceholder('https://archidekt.com/decks/123456 o https://www.moxfield.com/decks/...', { exact: true }).fill(url);
          } else await dialog.getByPlaceholder('Archidekt username', { exact: true }).fill('public_fixture');
          await dialog.getByRole('button', { name: source === 'URL' ? 'Import Deck' : 'Load Decks', exact: true }).click();
          await expect.poll(() => pending).toBe(round);
          await expect(dialog.getByRole('textbox')).toBeDisabled();
          if (action === 'close') {
            await dialog.getByRole('button', { name: 'Back', exact: true }).click();
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(dialog).toHaveCount(0);
          } else {
            await page.goBack();
            await expect(page).toHaveURL(/\/dashboard$/);
          }
          await expect.poll(() => cancelled).toBe(round);
          releases.forEach(release => release()); releases.clear();
          await expect(page.getByText('Late imported preview', { exact: true })).toHaveCount(0);
        }
      } finally { releases.forEach(release => release()); }
    });
  }
}

test('profile URL import cancels an older art selection without replacing the new commander', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  let primaryRequests = 0; let cancelled = 0; let partnerRequests = 0; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const art = (name: string, set: string, image: string) => ({ id: name, name, set_name: set,
    image_uris: { art_crop: image }, collector_number: '1', released_at: '2026-01-01' });
  await page.route('**/api/deck-import', route => route.fulfill({ status: 200, json: {
    name: 'Art preview fixture', commander: 'Art primary // Art partner', commanderImageUrl: '/favicon.ico?primary',
    commanderOptions: [{ name: 'Art primary', imageUrl: '/favicon.ico?primary', colorIdentity: ['U'] },
      { name: 'Art partner', imageUrl: '/favicon.ico?partner', colorIdentity: ['R'] }],
    bracket: '3', sourceUrl: 'https://archidekt.com/decks/123456', sourceType: 'archidekt',
  } }));
  const isPrimary = (url: string) => url.startsWith('https://api.scryfall.com/cards/search?')
    && new URL(url).searchParams.get('q')?.includes('Art primary');
  page.on('requestfailed', request => { if (isPrimary(request.url())) cancelled += 1; });
  await page.route('https://api.scryfall.com/cards/search?*', async route => {
    if (isPrimary(route.request().url())) {
      primaryRequests += 1;
      await wait;
      return route.fulfill({ status: 200, json: { data: [art('Art primary', 'Old printing', '/favicon.ico?old')] } })
        .catch(() => { /* Old cancelled selection may have closed its route. */ });
    }
    partnerRequests += 1;
    return route.fulfill({ status: 200, json: { data: [art('Art partner', 'Partner printing', '/favicon.ico?fresh-partner')] } });
  });
  await page.route('**/api/edhrec-*', route => route.fulfill({ status: 404, json: {} }));
  await openPasswordFixture(page);
  try {
    await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
    await page.getByRole('button', { name: /^Import from URL/ }).click();
    await page.getByRole('dialog').getByPlaceholder('https://archidekt.com/decks/123456 o https://www.moxfield.com/decks/...', { exact: true })
      .fill('https://archidekt.com/decks/123456');
    await page.getByRole('button', { name: 'Import Deck', exact: true }).click();
    await expect.poll(() => primaryRequests).toBe(1);
    await page.getByRole('dialog').getByRole('button', { name: /Art partner/ }).click();
    await expect.poll(() => cancelled).toBe(1);
    await expect(page.getByText('Partner printing', { exact: true })).toBeVisible();
    const preview = page.getByRole('heading', { name: 'Art preview fixture', exact: true }).locator('xpath=../..');
    await expect(preview.getByRole('img', { name: 'Art partner', exact: true })).toHaveAttribute('src', '/favicon.ico?partner');
    await page.getByRole('button', { name: /Partner printing/ }).click();
    release();
    await expect(preview.getByText('Art partner', { exact: true })).toBeVisible();
    await expect(preview.getByRole('img', { name: 'Art partner', exact: true })).toHaveAttribute('src', /fresh-partner/);
    await expect(page.getByText('Old printing', { exact: true })).toHaveCount(0);
    expect(primaryRequests).toBe(1); expect(partnerRequests).toBe(1);
  } finally { release(); }
});

for (const mode of ['single', 'bulk'] as const) {
  test(`profile source refresh ${mode} preserves errors, retry and the existing update payload`, async ({ page }) => {
    test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
    const userId = process.env.E2E_USER_ID!;
    const deckId = '00000000-0000-4000-8000-000000000020';
    const commander = 'External refresh commander';
    let writes = 0;
    let imports = 0;
    let budgetAllowed = false;
    let budgetRequests = 0;
    await openPasswordFixture(page);
    await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => route.fulfill({ status: 200, json: {
      schemaVersion: 2, scope: 'personal', userId, revision: 'd'.repeat(32), total: 1, next: null,
      decks: [{ id: deckId, user_id: userId, group_id: null, name: 'External refresh fixture', commander,
        commander_image: '/favicon.ico?refresh-current', commander_cmc: 4,
        commander_options: [{ name: commander, imageUrl: '/favicon.ico?refresh-current', colorIdentity: ['U'] }],
        color_identity: ['U'], bracket: '3', source_type: 'archidekt', source_url: 'https://archidekt.com/decks/345678',
        is_favorite: false, is_archived: false, created_at: '2026-01-01T00:00:00Z', updated_at: null }],
    } }));
    await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2', route => {
      const report = profileCatalogFixture(); report.userId = userId; report.decks[0].deck_id = deckId;
      return route.fulfill({ status: 200, json: report });
    });
    await page.route('**/api/profile/deck-refresh-budget', route => {
      budgetRequests += 1;
      return route.fulfill({ status: budgetAllowed ? 200 : 429, json: {} });
    });
    await page.route('**/api/deck-import', route => {
      expect(route.request().postDataJSON()).toEqual({ url: 'https://archidekt.com/decks/345678', fresh: true });
      imports += 1;
      return route.fulfill({ status: 200, json: { name: 'Refreshed external fixture', commander,
        commanderImageUrl: '/favicon.ico?refresh-source', commanderOptions: [{ name: commander,
          imageUrl: '/favicon.ico?refresh-source', colorIdentity: ['U'] }], colorIdentity: ['U'],
        bracket: '4', sourceType: 'archidekt', sourceUrl: 'https://archidekt.com/decks/345678' } });
    });
    await page.route('https://api.scryfall.com/cards/named?*', route => route.fulfill({ status: 200,
      json: { object: 'card', name: commander, cmc: 4 } }));
    await page.route('**/api/edhrec-*', route => route.fulfill({ status: 404, json: {} }));
    await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => {
      if (route.request().method() !== 'PATCH') return route.fulfill({ status: 403 });
      expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${deckId}`);
      expect(route.request().postDataJSON()).toMatchObject({ name: 'Refreshed external fixture', commander,
        commander_image: '/favicon.ico?refresh-current', commander_cmc: 4, bracket: '4', color_identity: ['U'] });
      writes += 1;
      return mode === 'single' && writes === 1
        ? route.fulfill({ status: 503, json: { message: 'Synthetic external refresh failure' } })
        : route.fulfill({ status: 204 });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'External refresh fixture', exact: true })).toBeVisible();
    const refresh = mode === 'single' ? page.getByTitle('Refresh from source', { exact: true })
      : page.getByRole('button', { name: 'Refresh Decks', exact: true });
    await refresh.click();
    await expect(page.getByText(mode === 'single' ? 'Deck not refreshed' : 'No decks updated', { exact: true })).toBeVisible();
    await expect(refresh).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'External refresh fixture', exact: true })).toBeVisible();
    expect(writes).toBe(mode === 'single' ? 1 : 0);
    expect(imports).toBe(mode === 'single' ? 1 : 0);
    budgetAllowed = true;
    await refresh.click();
    await expect(page.getByRole('heading', { name: 'Refreshed external fixture', exact: true })).toBeVisible();
    await expect(page.getByText(mode === 'single' ? 'Deck refreshed' : 'Refresh completed', { exact: true })).toBeVisible();
    expect(writes).toBe(mode === 'single' ? 2 : 1);
    expect(budgetRequests).toBe(mode === 'single' ? 0 : 2);
  });
}
