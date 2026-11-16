import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

nextEnv.loadEnvConfig(resolve(process.env.E2E_ENV_ROOT || '.'));
const url = process.env.SUPABASE_URL;
if (!url || new URL(url).hostname !== process.env.STAGING_SUPABASE_DOMAIN
  || process.env.SELFHOSTED_DEV_COMPOSE_PROJECT !== 'supabase-dev') throw new Error('Explicit Dev backend required');
const anonKey = process.env.SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = 'admqa_' + randomBytes(5).toString('hex');
const password = randomBytes(32).toString('base64url');
const created = [];
let adminEmail;
let exitCode = 1;
const check = result => { if (result.error) throw new Error('Admin E2E fixture operation failed: ' + result.error.code); };
try {
  for (let index = 0; index < 2; index += 1) {
    const email = `${tag}_${index}@example.com`;
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: `${tag}_${index}` } });
    check(result);
    if (!result.data.user) throw new Error('Missing synthetic user');
    created.push({ id: result.data.user.id, email });
    writeFileSync(resolve('artifacts/dev26/admin-e2e-fixtures.json'), JSON.stringify({ tag, created }));
  }
  adminEmail = created[0].email;
  check(await admin.from('platform_admin_emails').insert({ email: adminEmail }));
  check(await admin.from('access_logs').insert(created.map((user, index) => ({
    user_id: user.id, source: index ? 'app' : 'web', app_version: index ? '9.3.0' : null,
  }))));
  const sessions = [];
  for (const user of created) {
    const cookies = [];
    const client = createServerClient(url, anonKey, { auth: { storageKey: 'sb-supabase-staging-auth-token' },
      cookies: { getAll: () => cookies, setAll: values => cookies.push(...values) } });
    check(await client.auth.signInWithPassword({ email: user.email, password }));
    sessions.push(cookies.map(({ name, value }) => ({ name, value })));
  }
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3103', HOSTNAME: '127.0.0.1', SENTRY_ENABLED: 'false',
    E2E_PORT: '3103', E2E_BASE_URL: '',
    E2E_ADMIN_DIRECTORY: '1', E2E_ADMIN_TAG: tag, E2E_ADMIN_COOKIES: JSON.stringify(sessions[0]),
    E2E_MEMBER_COOKIES: JSON.stringify(sessions[1]),
  };
  // Use the same exact npm requested by packageManager when provided by the caller.
  const npmCli = process.env.DEV26_NPM_CLI || resolve('artifacts/dev26/tools/npm-pinned/node_modules/npm/bin/npm-cli.js');
  const build = spawnSync(process.execPath, [npmCli, 'run', 'build'], { env, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('Admin E2E candidate build failed');
  const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/admin-users.spec.ts',
    '--workers=1', '--trace=off'], { env, stdio: 'inherit' });
  exitCode = run.status ?? 1;
} finally {
  let cleaned = true;
  const cleanupFailure = (stage, error) => {
    cleaned = false;
    console.error(`Synthetic cleanup failed at ${stage}: ${error?.code || error?.status || 'verification'}`);
  };
  if (adminEmail) {
    let verified = false;
    for (let attempt = 0; attempt < 3 && !verified; attempt += 1) {
      const result = await admin.from('platform_admin_emails').delete().eq('email', adminEmail);
      const verify = await admin.from('platform_admin_emails').select('email').eq('email', adminEmail);
      verified = !result.error && !verify.error && verify.data?.length === 0;
      if (!verified) console.error(`Synthetic allowlist cleanup retry: ${result.error?.code || verify.error?.code || 'row remains'}`);
    }
    if (!verified) cleanupFailure('allowlist');
  }
  for (const user of created) {
    // Revoke the synthetic sessions before deleting their accounts.
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await client.auth.signInWithPassword({ email: user.email, password });
    if (!login.error) await client.auth.signOut({ scope: 'global' });
    const result = await admin.auth.admin.deleteUser(user.id);
    const verify = await admin.auth.admin.getUserById(user.id);
    if (result.error || verify.data?.user || (verify.error && verify.error.status !== 404 && verify.error.code !== 'user_not_found')) cleanupFailure('account', result.error || verify.error);
  }
  if (created.length) {
    const keys = created.flatMap(user => [`adminUsers:user:${user.id}`, `adminUsersExport:user:${user.id}`]);
    const remove = await admin.from('api_rate_limits').delete().in('bucket_key', keys);
    const verify = await admin.from('api_rate_limits').select('bucket_key').in('bucket_key', keys);
    if (remove.error || verify.error || verify.data?.length) cleanupFailure('rate buckets', remove.error || verify.error);
    const logs = await admin.from('access_logs').select('id', { count: 'exact', head: true }).in('user_id', created.map(user => user.id));
    if (logs.error || logs.count !== 0) cleanupFailure('logs', logs.error);
  }
  console.log(`Synthetic admin/member and allowlist cleanup: ${cleaned ? 'verified' : 'FAILED'}`);
  if (!cleaned) exitCode = 1;
}
process.exitCode = exitCode;
