import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeCiConfiguration } from '../../scripts/native-ci-config.mjs';

const environment = () => ({ CI: 'true', NATIVE_CI: '1', APP_VARIANT: 'dev',
  SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
  EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3000', EXPO_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
  SUPABASE_ANON_KEY: 'local-anon', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'local-anon', SUPABASE_SERVICE_ROLE_KEY: 'local-service',
});
test('native CI accepts a coherent explicitly selected disposable target', () => {
  assert.deepEqual(nativeCiConfiguration(environment()), { url: 'http://127.0.0.1:54321', anonKey: 'local-anon', serviceKey: 'local-service' });
});
test('native CI never falls back to an operator environment', () => {
  for (const [key, value] of [['CI', ''], ['NATIVE_CI', ''], ['APP_VARIANT', 'production']]) {
    assert.throws(() => nativeCiConfiguration({ ...environment(), [key]: value }), /Explicit isolated/);
  }
});
test('native CI rejects remote, credential-bearing, path, port and lookalike origins before fixture writes', () => {
  for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SITE_URL', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SITE_URL']) {
    for (const value of ['https://dev.21life.win', 'https://supabase-dev.21life.win', 'https://21life.win',
      'http://user:password@127.0.0.1:54321', 'http://127.0.0.1:54321/path', 'http://127.0.0.1:54322',
      'http://127.0.0.1.evil.invalid:54321', 'http://127.0.0.1:54321?target=dev']) {
      assert.throws(() => nativeCiConfiguration({ ...environment(), [key]: value }), /origin mismatch/);
    }
  }
});
test('native CI rejects missing, privileged-public and inconsistent keys', () => {
  for (const key of ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']) {
    assert.throws(() => nativeCiConfiguration({ ...environment(), [key]: '' }), /keys missing or inconsistent/);
  }
  assert.throws(() => nativeCiConfiguration({ ...environment(), EXPO_PUBLIC_SUPABASE_ANON_KEY: 'local-service' }), /keys missing or inconsistent/);
  assert.throws(() => nativeCiConfiguration({ ...environment(), SUPABASE_SERVICE_ROLE_KEY: 'local-anon' }), /keys missing or inconsistent/);
});
