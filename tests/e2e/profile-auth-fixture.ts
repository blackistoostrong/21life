import type { Page } from '@playwright/test';
import { profileCatalogFixture } from '../fixtures/profile-catalog';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAuthStorageKey } from '../../expo/lib/supabase-auth-storage-key';

/** Real disposable Auth session; SDK notification is the controlled cross-tab boundary.
 * No session/JWT/cookie values are returned to assertions, logs or artifacts. */
export async function transitionFixtureSession(page: Page, otherAccount = false) {
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


/** Empty catalog only for the second disposable Auth identity; never logs tokens. */
export async function mockEmptySecondAccountCatalog(page: Page) {
  const otherId = process.env.E2E_SECOND_USER_ID;
  if (!otherId) throw new Error('Second disposable account required');
  const isOther = (authorization: string | undefined) => {
    const token = authorization?.split(' ')[1];
    return token && JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub === otherId;
  };
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => {
    if (!isOther(route.request().headers().authorization)) return route.fallback();
    return route.fulfill({ status: 200, json: { schemaVersion: 2, scope: 'personal', userId: otherId,
      revision: 'e'.repeat(32), total: 0, next: null, decks: [] } });
  });
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2', route => {
    if (!isOther(route.request().headers().authorization)) return route.fallback();
    const report = profileCatalogFixture(); report.userId = otherId; report.total = 0; report.decks = [];
    return route.fulfill({ status: 200, json: report });
  });
}
