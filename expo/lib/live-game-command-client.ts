import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from './env';

type Snapshot = { user: { id: string }; access_token: string } | null;

/** One command retains its actor even if the application's shared SDK signs in as someone else. */
export function createLiveGameCommandClient(actorId: string | undefined, session: Snapshot) {
  if (!actorId || session?.user.id !== actorId || !session.access_token) {
    throw Object.assign(new Error('Sign-in required'), { status: 401 });
  }
  const accessToken = session.access_token;
  const client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    accessToken: async () => accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client, accessToken };
}
