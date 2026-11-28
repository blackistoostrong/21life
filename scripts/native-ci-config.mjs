// A distinct target: this must never fall back to the operator's Dev environment.
export function nativeCiConfiguration(env) {
  if (!['1', 'true'].includes(env.CI) || env.NATIVE_CI !== '1' || env.APP_VARIANT !== 'dev') {
    throw new Error('Explicit isolated native CI target required');
  }
  const expected = {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
    EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3000',
    EXPO_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
  };
  for (const [name, value] of Object.entries(expected)) {
    if (env[name] !== value) throw new Error(`Isolated native CI origin mismatch: ${name}`);
  }
  const anonKey = env.SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anonKey?.trim() || !serviceKey?.trim() || serviceKey === anonKey
    || env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== anonKey || env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== anonKey) {
    throw new Error('Isolated native CI keys missing or inconsistent');
  }
  return { url: expected.SUPABASE_URL, anonKey, serviceKey };
}
