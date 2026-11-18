import { expect, test, type Page } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { openPasswordFixture } from './profile-fixture';
import { getSupabaseAuthStorageKey } from '../../expo/lib/supabase-auth-storage-key';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

/** Real disposable Auth session; SDK notification is the controlled cross-tab boundary.
 * No session/JWT/cookie values are returned to assertions, logs or artifacts. */
async function transitionFixtureSession(page: Page, otherAccount = false) {
  const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (new URL(backend).hostname !== process.env.STAGING_SUPABASE_DOMAIN) throw new Error('Dev Auth fixture required');
  const key = getSupabaseAuthStorageKey(backend);
  const jar = new Map((await page.context().cookies()).map(cookie => [cookie.name, cookie.value]));
  const updates = new Map<string, { name: string; value: string; expires?: number }>();
  const client = createServerClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { storageKey: key },
    cookies: { getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: values => { for (const { name, value, options } of values) {
        jar.set(name, value); updates.set(name, { name, value, ...(options.maxAge === 0 ? { expires: 0 } : {}) });
      } },
    },
  });
  // Give this browser test its own disposable session before refreshing: the
  // runner's shared fixture refresh token must remain reusable by other cases.
  const signedIn = await client.auth.signInWithPassword({
    email: otherAccount ? process.env.E2E_SECOND_EMAIL! : process.env.E2E_USERNAME!, password: process.env.E2E_PASSWORD!,
  });
  if (signedIn.error) throw new Error('Disposable renewal session could not be created');
  const { data, error } = otherAccount ? signedIn : await client.auth.refreshSession();
  const expectedId = otherAccount ? process.env.E2E_SECOND_USER_ID : process.env.E2E_USER_ID;
  if (error || !data.session || data.session.user.id !== expectedId) throw new Error('Disposable Auth transition failed');
  await page.context().addCookies(Array.from(updates.values(), cookie => ({ ...cookie, url: new URL(page.url()).origin })));
  await page.evaluate(({ storageKey, session, event }) => {
    // Wire format verified against the installed auth-js BroadcastChannel handler.
    const channel = new BroadcastChannel(storageKey);
    channel.postMessage({ event, session });
    setTimeout(() => channel.close(), 0);
  }, { storageKey: key, session: data.session, event: otherAccount ? 'SIGNED_IN' : 'TOKEN_REFRESHED' });
}

test('profile auth renewal preserves dirty account and public import drafts while role revalidation is pending', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  await openPasswordFixture(page);
  let roleReads = 0; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/rpc/is_admin', async route => {
    expect(route.request().postDataJSON()).toEqual({ p_user_id: process.env.E2E_USER_ID });
    roleReads += 1; await wait;
    await route.fulfill({ status: 200, json: false }).catch(() => {});
  });
  try {
    await page.getByPlaceholder('Archidekt username', { exact: true }).fill('settings_refresh_draft');
    await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
    await page.getByRole('button', { name: /^Import by Archidekt username/ }).click();
    const input = page.getByRole('dialog').getByPlaceholder('Archidekt username', { exact: true });
    await input.fill('public_refresh_draft');
    await transitionFixtureSession(page);
    await expect.poll(() => roleReads).toBe(1);
    await expect(input).toHaveValue('public_refresh_draft');
    release();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(input).toHaveValue('public_refresh_draft');
    await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByPlaceholder('Archidekt username', { exact: true })).toHaveValue('settings_refresh_draft');
  } finally { release(); }
});

test('profile auth account switch cancels the old autosync and masks old drafts while resolving the new identity', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  await openPasswordFixture(page);
  const firstId = process.env.E2E_USER_ID!; const secondId = process.env.E2E_SECOND_USER_ID!;
  let oldRead = 0; let oldCancelled = 0; let newRole = 0; let newRead = 0; let writes = 0;
  let releaseOld!: () => void; let releaseRole!: () => void;
  const oldWait = new Promise<void>(resolve => { releaseOld = resolve; });
  const roleWait = new Promise<void>(resolve => { releaseRole = resolve; });
  const subject = (authorization: string) => {
    const id = JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub as string;
    if (![firstId, secondId].includes(id)) throw new Error('Unexpected disposable Auth subject');
    return id;
  };
  page.on('requestfailed', request => { if (request.url().includes('/api/archidekt-user-decks')) oldCancelled += 1; });
  await page.route('**/rest/v1/rpc/is_admin', async route => {
    if (route.request().postDataJSON().p_user_id === secondId) { newRole += 1; await roleWait; }
    await route.fulfill({ status: 200, json: false }).catch(() => {});
  });
  await page.route('**/rest/v1/profiles?*', route => {
    if (route.request().method() === 'PATCH') {
      expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${firstId}`);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 200, json: [
      { id: firstId, username: 'account_fixture', display_name: null, archidekt_username: 'old_owner', archidekt_auto_import: true, archidekt_last_sync_at: null },
      { id: secondId, username: 'second_account_fixture', display_name: null, archidekt_username: 'new_owner', archidekt_auto_import: true, archidekt_last_sync_at: null },
    ] });
  });
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => route.fulfill({ status: 200,
    json: { schemaVersion: 2, scope: 'personal', userId: subject(route.request().headers().authorization),
      revision: 'f'.repeat(32), total: 0, next: null, decks: [] } }));
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2', route => {
    const report = profileCatalogFixture(); report.userId = subject(route.request().headers().authorization);
    report.total = 0; report.decks = [];
    return route.fulfill({ status: 200, json: report });
  });
  await page.route('**/rest/v1/rpc/sync_archidekt_decks', route => { writes += 1; return route.fulfill({ status: 200, json: [] }); });
  await page.route('**/api/archidekt-user-decks', async route => {
    const username = route.request().postDataJSON().username;
    if (username === 'old_owner') { oldRead += 1; await oldWait; } else {
      expect(username).toBe('new_owner'); newRead += 1;
      expect(subject(route.request().headers().authorization)).toBe(secondId);
    }
    await route.fulfill({ status: 200, json: { decks: [] } }).catch(() => {});
  });
  try {
    await page.getByPlaceholder('Archidekt username', { exact: true }).fill('old_owner');
    await page.getByRole('checkbox', { name: /Automatically import new decks/ }).check();
    await page.getByRole('button', { name: 'Save Archidekt', exact: true }).click();
    await expect.poll(() => oldRead).toBe(1);
    await page.getByPlaceholder('Archidekt username', { exact: true }).fill('old_private_draft');
    await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
    await page.getByRole('button', { name: /^Import by Archidekt username/ }).click();
    await page.getByRole('dialog').getByPlaceholder('Archidekt username', { exact: true }).fill('old_private_import');
    await transitionFixtureSession(page, true);
    await expect.poll(() => newRole).toBe(1);
    await expect.poll(() => oldCancelled).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    releaseRole();
    await expect.poll(() => newRead).toBe(1);
    await expect(page.getByRole('dialog').getByPlaceholder('Archidekt username', { exact: true })).toHaveValue('new_owner');
    releaseOld();
    await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'second_account_fixture', exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('Archidekt username', { exact: true })).toHaveValue('new_owner');
    expect(writes).toBe(0);
  } finally { releaseOld(); releaseRole(); }
});
