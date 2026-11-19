import type { Page } from '@playwright/test';
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

