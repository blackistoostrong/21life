import { expect, test } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

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
