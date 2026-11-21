import { expect, type Page } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

export async function openPasswordFixture(page: Page) {
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
