import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Module, { createRequire } from 'node:module';
import nextEnv from '@next/env';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
nextEnv.loadEnvConfig(resolve(process.env.E2E_ENV_ROOT || '.'));
const env = process.env;
const url = env.SUPABASE_URL;
const anon = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || new URL(url).hostname !== env.STAGING_SUPABASE_DOMAIN || env.SELFHOSTED_DEV_COMPOSE_PROJECT !== 'supabase-dev'
  || !anon || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Explicit configured Dev backend required');
env.NEXT_PUBLIC_SUPABASE_URL = url;
env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
const sshArgs = ['-o', 'BatchMode=yes'];
if (env.SELFHOSTED_DEV_VM_PORT) {
  const port = Number(env.SELFHOSTED_DEV_VM_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Dev SSH port');
  sshArgs.push('-p', String(port));
}
if (env.SELFHOSTED_DEV_VM_KEY_PATH) sshArgs.push('-i', env.SELFHOSTED_DEV_VM_KEY_PATH);
if (!/^[a-z0-9_.-]+$/i.test(env.SELFHOSTED_DEV_VM_USER || '') || !/^[a-z0-9_.:-]+$/i.test(env.SELFHOSTED_DEV_VM_HOST || '')) {
  throw new Error('Valid Dev SSH target required');
}
sshArgs.push(env.SELFHOSTED_DEV_VM_USER + '@' + env.SELFHOSTED_DEV_VM_HOST, 'bash -seuo pipefail');
function remote(script) {
  const result = spawnSync('ssh', sshArgs, { input: script, encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  if (result.status !== 0) throw new Error('Dev read-only SSH check failed');
  return result.stdout.trim();
}
const flags = ['GOTRUE_MAILER_NOTIFICATIONS_PASSWORD_CHANGED_ENABLED',
  'GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD', 'GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION'];
const metadata = remote(`container="$(docker ps -q --filter label=com.docker.compose.project=supabase-dev --filter label=com.docker.compose.service=auth)"
[[ "$container" =~ ^[a-f0-9]+$ ]]
docker inspect --format '{{.Config.Image}}' "$container"
docker inspect --format '{{json .Config.Env}}' "$container" | python3 -c 'import json,sys; values=dict(x.split("=",1) for x in json.load(sys.stdin) if "=" in x); keys=${JSON.stringify(flags)}; print(json.dumps({k:values.get(k) for k in keys}))'
`).split('\n');
const image = metadata[0].trim();
const settings = JSON.parse(metadata[1]);
// The checked source tag defaults these notifications to false; review other tags first.
if (image !== 'supabase/gotrue:v2.189.0') throw new Error('Review Auth defaults for the deployed image before live password QA');
if (!['', 'false', '0'].includes(String(settings[flags[0]] ?? '').toLowerCase())) {
  throw new Error('Password email notifications must be disabled before this disposable QA');
}

// Load the actual TS adapter under the pinned compiler; never duplicate the algorithm.
const require = createRequire(import.meta.url);
const resolveFilename = Module._resolveFilename;
const extension = Module._extensions['.ts'];
let changeProfilePassword;
try {
  Module._resolveFilename = function (request, parent, ...rest) {
    return resolveFilename.call(this, request.startsWith('@/') ? resolve(root, request.slice(2)) : request, parent, ...rest);
  };
  Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file);
  ({ changeProfilePassword } = require(resolve(root, 'lib/profile-password.ts')));
} finally {
  Module._resolveFilename = resolveFilename;
  if (extension) Module._extensions['.ts'] = extension;
  else delete Module._extensions['.ts'];
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (target, init) => fetch(target, { ...init, signal: AbortSignal.timeout(10_000) }) } };
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, options);
const main = createClient(url, anon, options);
const probe = createClient(url, anon, options);
const suffix = randomBytes(8).toString('hex');
const email = `dev26-password-${suffix}@example.com`;
const oldPassword = `Qa1!${randomBytes(16).toString('hex')}`;
const nextPassword = `Next2!${randomBytes(16).toString('hex')}`;
const checks = {};
const failures = [];
const manifestPath = resolve(root, 'artifacts/dev26/profile-password-live-fixture.json');
mkdirSync(resolve(root, 'artifacts/dev26'), { recursive: true });
if (existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, 'utf8')).pending) {
  throw new Error('Clean up the recorded owned password QA fixture before creating another');
}
let userId;
function verify(condition, stage) {
  if (!condition) { failures.push(stage); throw new Error('Password Dev QA failed at ' + stage); }
}
try {
  writeFileSync(manifestPath, JSON.stringify({ pending: true, requestTag: suffix, fixtureEmail: email }) + '\n');
  const created = await admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true,
    user_metadata: { username: `pwqa_${suffix}` } });
  verify(!created.error && created.data.user, 'fixture creation');
  userId = created.data.user.id;
  writeFileSync(manifestPath, JSON.stringify({ userId, pending: true }) + '\n');
  const signed = await main.auth.signInWithPassword({ email, password: oldPassword });
  verify(!signed.error && signed.data.session, 'original sign-in');
  const original = signed.data.session;
  const sessionId = JSON.parse(Buffer.from(original.access_token.split('.')[1], 'base64url').toString()).session_id;
  const result = await changeProfilePassword({ session: original, userId, email,
    currentPassword: oldPassword, newPassword: nextPassword });
  await result.cleanup;
  const current = await main.auth.getSession();
  verify(!current.error && current.data.session?.access_token === original.access_token, 'original client isolation');
  checks.originalClientUnchanged = true;
  const refreshed = await main.auth.refreshSession();
  verify(!refreshed.error && refreshed.data.user?.id === userId, 'original refresh token preserved');
  checks.originalSessionPreserved = true;
  const rejected = await probe.auth.signInWithPassword({ email, password: oldPassword });
  verify(rejected.error?.code === 'invalid_credentials', 'old password rejected');
  const accepted = await probe.auth.signInWithPassword({ email, password: nextPassword });
  verify(!accepted.error && accepted.data.user?.id === userId, 'new password accepted');
  verify(!(await probe.auth.signOut({ scope: 'local' })).error, 'probe session revoked');
  checks.passwordChanged = true;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  verify(uuid.test(userId) && uuid.test(sessionId), 'owned session identifiers');
  const role = env.SELFHOSTED_DEV_DB_USER || 'supabase_admin';
  verify(/^[a-z_][a-z0-9_]*$/i.test(role), 'read-only database role');
  const rows = remote(`container="$(docker ps -q --filter label=com.docker.compose.project=supabase-dev --filter label=com.docker.compose.service=db)"
[[ "$container" =~ ^[a-f0-9]+$ ]]
docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U ${role} -d postgres <<'SQL'
BEGIN READ ONLY;
SELECT json_build_object('count',count(*),'onlyOriginal',bool_and(id='${sessionId}'::uuid)) FROM auth.sessions WHERE user_id='${userId}'::uuid;
ROLLBACK;
SQL
`);
  const sessions = JSON.parse(rows.split('\n').find(line => line.startsWith('{')));
  verify(sessions.count === 1 && sessions.onlyOriginal === true, 'temporary sessions removed');
  checks.onlyOriginalSessionRemains = true;
} finally {
  try {
    if (userId) {
      verify(!(await admin.auth.admin.deleteUser(userId)).error, 'fixture deletion');
      const deleted = await admin.auth.admin.getUserById(userId);
      verify(deleted.error?.status === 404, 'fixture Auth cleanup');
      const profiles = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('id', userId);
      verify(!profiles.error && profiles.count === 0, 'fixture profile cleanup');
      checks.cleanupVerified = true;
      writeFileSync(manifestPath, JSON.stringify({ userId, pending: false }) + '\n');
    }
  } finally {
    await Promise.all([admin.auth.dispose(), main.auth.dispose(), probe.auth.dispose()]);
    writeFileSync(resolve(root, 'artifacts/dev26/profile-password-live-qa.json'), JSON.stringify({ image, settings, checks, failures }, null, 2) + '\n');
  }
}
console.log('Password Dev QA PASS: actual change, original session/refresh preserved, no temporary sessions; fixture cleanup verified.');
