import { expect, test } from '@playwright/test';
import { openPasswordFixture } from './profile-fixture';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

test('profile commander editor preserves failed art choice and retries the correct deck update', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const userId = process.env.E2E_USER_ID!;
  const deckId = '00000000-0000-4000-8000-000000000003';
  const commander = 'Editor commander';
  let attempts = 0;
  await openPasswordFixture(page);
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => route.fulfill({ status: 200, json: {
    schemaVersion: 2, scope: 'personal', userId, revision: 'b'.repeat(32), total: 1, next: null,
    decks: [{ id: deckId, user_id: userId, group_id: null, name: 'Editor deck fixture', commander,
      commander_image: '/favicon.ico?editor-old', commander_cmc: 4,
      commander_options: [{ name: commander, imageUrl: '/favicon.ico?editor-old', colorIdentity: ['U'] }],
      color_identity: ['U'], bracket: '3', source_type: 'manual', source_url: null,
      is_favorite: false, is_archived: false, created_at: '2026-01-01T00:00:00Z', updated_at: null }],
  } }));
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2', route => {
    const report = profileCatalogFixture(); report.userId = userId; report.decks[0].deck_id = deckId;
    return route.fulfill({ status: 200, json: report });
  });
  await page.route('https://api.scryfall.com/cards/search?*', route => route.fulfill({ status: 200, json: { data: [{
    id: 'editor-print', name: commander, image_uris: { art_crop: '/favicon.ico?editor-new' },
    set_name: 'Editor printing', collector_number: '1', released_at: '2026-01-01',
  }] } }));
  await page.route('https://api.scryfall.com/cards/named?*', route => route.fulfill({ status: 200, json: { object: 'card', name: commander, cmc: 4 } }));
  await page.route('**/rest/v1/decks?*', route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${deckId}`);
    expect(route.request().postDataJSON()).toMatchObject({ commander,
      commander_image: '/favicon.ico?editor-new', commander_cmc: 4, color_identity: ['U'] });
    attempts += 1;
    return attempts === 1 ? route.fulfill({ status: 503, json: { message: 'Synthetic editor save failure' } })
      : route.fulfill({ status: 204 });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Editor deck fixture', exact: true })).toBeVisible();
  await page.getByTitle('Edit commander', { exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Edit commander', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: /Editor printing/ }).click();
  await expect(page.getByText('Synthetic editor save failure', { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Editor printing/ })).toBeEnabled();
  await dialog.getByRole('button', { name: /Editor printing/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Commander updated', { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  const deckCard = page.locator('[data-web-card]').filter({ has: page.getByRole('heading', { name: 'Editor deck fixture', exact: true }) });
  await expect(deckCard.getByRole('img', { name: commander, exact: true })).toHaveAttribute('src', /editor-new/);
});
