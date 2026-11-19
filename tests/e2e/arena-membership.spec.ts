import { expect, test, type Page } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { transitionFixtureSession } from './profile-auth-fixture';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

type Operation = 'kick' | 'leave' | 'delete';
async function openCommand(page: Page, operation: Operation) {
  await expect(page).toHaveURL(/\/table\/[^/]+$/);
  await expect(page.getByRole('button', { name: 'Back to home', exact: true })).toBeVisible();
  if (operation === 'kick') {
    await page.getByRole('tab', { name: /Players/ }).click();
    return page.getByTitle('Remove member', { exact: true });
  }
  const groupName = operation === 'delete' ? await page.getByRole('heading', { level: 1 }).innerText() : '';
  await page.getByRole('button', { name: operation === 'leave' ? 'Leave playgroup' : 'Delete playgroup', exact: true })
    .filter({ visible: true }).first().click();
  if (operation === 'leave') {
    await page.getByLabel('Confirmation', { exact: true }).fill('confirm');
    return page.getByRole('button', { name: 'Leave', exact: true });
  }
  await page.getByPlaceholder(groupName, { exact: true }).fill(groupName);
  return page.getByRole('button', { name: 'Delete Playgroup', exact: true });
}

test('arena membership dialogs preserve confirmation, cancel and reopening', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
  for (const operation of ['leave', 'delete'] as const) {
    await openCommand(page, operation);
    const input = operation === 'leave' ? page.getByLabel('Confirmation', { exact: true })
      : page.getByPlaceholder('IMP synthetic playgroup', { exact: true });
    await input.fill('invalid confirmation');
    await expect(page.getByRole('button', { name: operation === 'leave' ? 'Leave' : 'Delete Playgroup', exact: true })).toBeDisabled();
    if (process.env.E2E_MEMBERSHIP_CAPTURE) await page.getByRole('dialog').locator('.max-w-md').screenshot({
      path: `artifacts/dev26/membership-${operation}-${test.info().project.name}-${process.env.E2E_MEMBERSHIP_CAPTURE}.png`, animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: operation === 'leave' ? 'Leave playgroup' : 'Delete playgroup', exact: true })
      .filter({ visible: true }).first().click();
    await expect(input).toHaveValue('');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('arena membership discards previous account confirmation when that account returns', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
  await openCommand(page, 'delete');
  await transitionFixtureSession(page, true);
  await expect(page.getByRole('heading', { name: 'Delete Playgroup', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete playgroup', exact: true })).toHaveCount(0);
  await transitionFixtureSession(page, false);
  await expect(page.getByRole('button', { name: 'Delete playgroup', exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Delete Playgroup', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete playgroup', exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByPlaceholder('IMP synthetic playgroup', { exact: true })).toHaveValue('');
});

for (const operation of ['kick', 'leave', 'delete'] as const) {
  test(`arena membership ${operation} blocks duplicate writes and requires an acknowledged row`, async ({ page }) => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    await fixtureLogin(page);
    const groupId = process.env.E2E_GROUP_ID!;
    await page.locator(`a[href="/table/${groupId}"]`).first().click();
    const button = await openCommand(page, operation);
    let writes = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/rest/v1/${operation === 'delete' ? 'groups' : 'group_members'}?*`, async route => {
      const request = route.request();
      if (request.method() !== 'DELETE') return route.fallback();
      const params = new URL(request.url()).searchParams;
      expect(params.get(operation === 'delete' ? 'id' : 'group_id')).toBe(`eq.${groupId}`);
      expect(params.get('select')).toBe(operation === 'delete' ? 'id' : 'user_id');
      if (operation !== 'delete') expect(params.get('user_id')).toBe(`eq.${process.env[operation === 'leave' ? 'E2E_USER_ID' : 'E2E_SECOND_USER_ID']}`);
      writes += 1;
      if (writes === 1) {
        await pending;
        return route.fulfill({ status: 503, json: { message: 'Synthetic membership failure' } });
      }
      return route.fulfill({ status: 200, json: writes === 2 ? [] : operation === 'delete'
        ? [{ id: groupId }] : [{ user_id: process.env[operation === 'leave' ? 'E2E_USER_ID' : 'E2E_SECOND_USER_ID'] }] });
    });
    try {
      await button.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
      await expect.poll(() => writes).toBe(1);
      release();
      await expect(page.getByText('Synthetic membership failure', { exact: true })).toBeVisible();
      await expect(button).toBeEnabled();
      await button.click();
      await expect(page.getByText(operation === 'delete' ? 'Playgroup was not deleted. Refresh and retry.'
        : 'Membership was not removed. Refresh the playgroup and retry.', { exact: true })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/table/${groupId}$`));
      await expect(button).toBeEnabled();
      await button.click();
      await expect.poll(() => writes).toBe(3);
      if (operation === 'kick') await expect(page.getByText('Player removed', { exact: true })).toBeVisible();
      else await expect(page).toHaveURL(/\/dashboard$/);
    } finally { release(); }
  });

  test(`arena membership ${operation} acknowledges the actual Dev deletion`, async ({ page }) => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    if (new URL(backend).hostname !== process.env.STAGING_SUPABASE_DOMAIN) throw new Error('Dev fixture required');
    // Service client provisions and verifies only this test's disposable group.
    const fixture = createClient(backend, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const groupId = randomUUID();
    try {
      const seeded = await fixture.from('groups').insert({ id: groupId, name: `Membership fixture ${groupId.slice(0, 8)}`, created_by: process.env.E2E_USER_ID! });
      expect(seeded.error).toBeNull();
      const members = await fixture.from('group_members').upsert([process.env.E2E_USER_ID!, process.env.E2E_SECOND_USER_ID!]
        .map(user_id => ({ group_id: groupId, user_id })), { onConflict: 'group_id,user_id' });
      expect(members.error).toBeNull();
      await fixtureLogin(page);
      await page.locator(`a[href="/table/${groupId}"]`).first().click();
      const button = await openCommand(page, operation);
      await button.click();
      if (operation === 'kick') await expect(page.getByText('Player removed', { exact: true })).toBeVisible();
      else await expect(page).toHaveURL(/\/dashboard$/);
      const deleted = operation === 'delete'
        ? await fixture.from('groups').select('id').eq('id', groupId)
        : await fixture.from('group_members').select('user_id').eq('group_id', groupId)
          .eq('user_id', process.env[operation === 'leave' ? 'E2E_USER_ID' : 'E2E_SECOND_USER_ID']!);
      expect(deleted.error).toBeNull(); expect(deleted.data).toEqual([]);
    } finally {
      const cleanup = await fixture.from('groups').delete().eq('id', groupId);
      expect(cleanup.error).toBeNull();
      const verified = await fixture.from('groups').select('id').eq('id', groupId);
      expect(verified.error).toBeNull(); expect(verified.data).toEqual([]);
    }
  });
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
