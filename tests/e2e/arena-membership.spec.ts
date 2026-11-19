import { expect, test, type Page } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { transitionFixtureSession } from './profile-auth-fixture';

type Operation = 'kick' | 'leave' | 'delete';
async function openCommand(page: Page, operation: Operation) {
  if (operation === 'kick') {
    await page.getByRole('tab', { name: /Players/ }).click();
    return page.getByTitle('Remove member', { exact: true });
  }
  await page.getByRole('button', { name: operation === 'leave' ? 'Leave playgroup' : 'Delete playgroup', exact: true })
    .filter({ visible: true }).first().click();
  if (operation === 'leave') {
    await page.getByLabel('Confirmation', { exact: true }).fill('confirm');
    return page.getByRole('button', { name: 'Leave', exact: true });
  }
  const groupName = await page.getByRole('heading', { level: 1 }).innerText();
  await page.getByPlaceholder(groupName, { exact: true }).fill(groupName);
  return page.getByRole('button', { name: 'Delete Playgroup', exact: true });
}

for (const operation of ['kick', 'leave', 'delete'] as const) {
  for (const departure of ['navigate', 'account'] as const) {
    test(`arena membership ${operation} cancels its command on ${departure}`, async ({ page }) => {
      test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
      await fixtureLogin(page);
      const groupId = process.env.E2E_GROUP_ID!;
      await page.locator(`a[href="/table/${groupId}"]`).first().click();
      const button = await openCommand(page, operation);
      let started = 0, aborted = 0;
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const requests = new Set<import('@playwright/test').Request>();
      page.on('requestfailed', request => { if (requests.has(request)) aborted += 1; });
      await page.route(`**/rest/v1/${operation === 'delete' ? 'groups' : 'group_members'}?*`, async route => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        requests.add(route.request()); started += 1;
        await pending;
        await route.fulfill({ status: 503, json: { message: 'Synthetic membership failure' } }).catch(() => { /* Disposed command. */ });
      });
      try {
        await button.click();
        await expect.poll(() => started).toBe(1);
        if (departure === 'navigate') {
          await page.goBack();
          await expect(page).toHaveURL(/\/dashboard$/);
        } else {
          await transitionFixtureSession(page, true);
          await expect(page.getByRole('button', { name: 'Back to home', exact: true })).toBeVisible();
        }
        await expect.poll(() => aborted).toBe(1);
        release();
        if (departure === 'account') {
          await expect(page.getByRole('heading', { name: /^(Leave playgroup|Delete Playgroup)$/ })).toHaveCount(0);
          await expect(page.getByText('Synthetic membership failure', { exact: true })).toHaveCount(0);
        }
      } finally { release(); }
    });
  }
}
