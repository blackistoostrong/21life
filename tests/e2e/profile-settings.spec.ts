import { expect, test } from '@playwright/test';
import { openPasswordFixture } from './profile-fixture';

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
