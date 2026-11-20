import { expect, test, type Page } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { transitionFixtureSession } from './profile-auth-fixture';
import { seedArenaMatch } from './fixtures/arena-match';

async function openExport(page: Page, groupId: string) {
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${groupId}"]`).first().click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Export matches', exact: true })).toBeVisible();
  await expect(page.getByText('1 matches in period · complete export', { exact: true })).toBeVisible();
}

test('arena session export clears its private draft after account A to B to A', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedArenaMatch();
  try {
    await openExport(page, fixture.groupId);
    await page.getByPlaceholder('Write the post intro...', { exact: true }).fill('private-session-intro');
    await transitionFixtureSession(page, true);
    await expect(page.getByRole('heading', { name: 'Export matches', exact: true })).toHaveCount(0);
    await transitionFixtureSession(page, false);
    await expect(page.getByRole('button', { name: 'Back to home', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Export matches', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByPlaceholder('Write the post intro...', { exact: true })).toHaveValue('');
  } finally { await fixture.cleanup(); }
});

test('arena session export ignores an old share acknowledgement after closing and reopening', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedArenaMatch();
  try {
    await openExport(page, fixture.groupId);
    await page.evaluate(() => {
      const port = { calls: 0, complete: () => {} };
      Object.assign(window, { sessionExportPort: port });
      Object.defineProperty(navigator, 'share', { configurable: true, value: () => {
        port.calls += 1;
        return new Promise<void>(resolve => { port.complete = resolve; });
      } });
    });
    await page.getByRole('button', { name: 'Generate export', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { sessionExportPort: { calls: number } }).sessionExportPort.calls)).toBe(1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByPlaceholder('Write the post intro...', { exact: true }).fill('new-opening-intro');
    await page.evaluate(async () => {
      (window as unknown as { sessionExportPort: { complete: () => void } }).sessionExportPort.complete();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await expect(page.getByRole('heading', { name: 'Export matches', exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('Write the post intro...', { exact: true })).toHaveValue('new-opening-intro');
  } finally { await fixture.cleanup(); }
});
