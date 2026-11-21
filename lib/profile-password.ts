import { createClient, isAuthSessionMissingError, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { withRequestDeadline } from '@/packages/data/request-deadline';

export class ProfilePasswordError extends Error {
  constructor(public readonly code: 'current-password' | 'session-expiring' | 'session-unavailable') {
    super(code);
  }
}

function checkActive(signal: AbortSignal) {
  if (!signal.aborted) return;
  const error = new Error('Password operation aborted');
  error.name = 'AbortError';
  throw error;
}

/** Verify privately, then update under the original session without replacing browser auth. */
export async function changeProfilePassword(input: {
  session: Session; userId: string; email: string; currentPassword: string; newPassword: string; signal?: AbortSignal;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || input.session.user.id !== input.userId) throw new ProfilePasswordError('session-unavailable');
  const owned: { client: SupabaseClient | null } = { client: null };
  let verificationToken: string | null = null;
  let requestSignal: AbortSignal;
  let cleanup: Promise<void> = Promise.resolve();
  try {
    await withRequestDeadline({ abortSignal: async signal => {
      checkActive(signal);
      // Avoid a private client refreshing a main-session token behind the app's back.
      if (!input.session.expires_at || input.session.expires_at * 1000 <= Date.now() + 20_000) {
        throw new ProfilePasswordError('session-expiring');
      }
      requestSignal = signal;
      const isolated = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
          storageKey: `21life-password-check:${crypto.randomUUID()}` },
        global: { fetch: (target, options) => fetch(target, { ...options, signal: requestSignal }) },
      });
      owned.client = isolated;
      const verification = await isolated.auth.signInWithPassword({ email: input.email, password: input.currentPassword });
      verificationToken = verification.data.session?.access_token ?? null;
      checkActive(signal);
      if (verification.error) {
        if (verification.error.code === 'invalid_credentials' || verification.error.status === 400) {
          throw new ProfilePasswordError('current-password');
        }
        throw verification.error;
      }
      if (!verificationToken || verification.data.user?.id !== input.userId) throw new ProfilePasswordError('session-unavailable');
      const restored = await isolated.auth.setSession({
        access_token: input.session.access_token, refresh_token: input.session.refresh_token,
      });
      checkActive(signal);
      if (restored.error) throw restored.error;
      if (restored.data.user?.id !== input.userId) throw new ProfilePasswordError('session-unavailable');
      const updated = await isolated.auth.updateUser({ password: input.newPassword, current_password: input.currentPassword });
      checkActive(signal);
      if (updated.error) throw updated.error;
      if (updated.data.user?.id !== input.userId) throw new ProfilePasswordError('session-unavailable');
    } }, 15_000, input.signal, 'PROFILE_PASSWORD_TIMEOUT');
  } finally {
    const isolated = owned.client;
    if (isolated) {
      cleanup = (async () => {
        try {
          // Explicit JWT: never log out the app's original session, even after setSession.
          if (verificationToken && verificationToken !== input.session.access_token) {
            try {
              const result = await withRequestDeadline({ abortSignal: signal => {
                requestSignal = signal;
                return isolated.auth.admin.signOut(verificationToken!, 'local');
              } }, 2_000);
              if (result.error && !isAuthSessionMissingError(result.error) && ![401, 403, 404].includes(result.error.status ?? 0)) {
                console.warn('Temporary password verification cleanup was not acknowledged',
                  { code: result.error.code, status: result.error.status, name: result.error.name });
              }
            } catch {
              // Cleanup cannot turn an already accepted password change into a failure.
              console.warn('Temporary password verification cleanup did not finish');
            }
          }
        } finally {
          await isolated.auth.dispose();
        }
      })().catch(() => { console.warn('Temporary password client cleanup did not finish'); });
    }
  }
  // An acknowledged password update must not time out while optional cleanup runs.
  return { cleanup };
}
