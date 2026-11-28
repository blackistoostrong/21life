import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { nativeCiConfiguration } from './native-ci-config.mjs';
import { runMaestro } from '../expo/scripts/maestro-command.mjs';
import { assertStagingBackendReachable, assertStagingPreviewReachable } from './staging-backend-preflight.mjs';

const config = nativeCiConfiguration(process.env);
await assertStagingBackendReachable(config.url, config.serviceKey);
await assertStagingPreviewReachable(process.env.NEXT_PUBLIC_SITE_URL);
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!process.env.GITHUB_SHA || sha !== process.env.GITHUB_SHA) throw Error('Native CI source SHA mismatch');
execFileSync('git', ['diff', '--exit-code'], { stdio: 'inherit' });
execFileSync(process.execPath, ['expo/scripts/e2e-android-preflight.mjs'], { stdio: 'inherit' });
const apk = resolve('expo/android/app/build/outputs/apk/debug/app-debug.apk');
const apkSha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
const directory = resolve(process.env.RUNNER_TEMP, 'native-ci');
mkdirSync(directory, { recursive: true });
const admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const outcomes = [];
const check = (result) => { if (result.error) throw Error(`Native CI fixture operation failed: ${result.error.code ?? result.status}`); };

function redact(directory, secrets) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) redact(path, secrets);
    else if (/\.(json|log|txt|xml|yaml|yml|md)$/.test(entry.name)) {
      let text = readFileSync(path, 'utf8');
      for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
      writeFileSync(path, text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]'));
    }
  }
}

for (const attempt of [1, 2, 3]) {
  const groupId = randomUUID();
  const password = randomBytes(32).toString('base64url');
  const tag = `nci_${randomBytes(6).toString('hex')}`;
  const users = [];
  const decks = [];
  const debug = join(directory, `attempt-${attempt}`);
  mkdirSync(debug, { recursive: true });
  let passed = false;
  try {
    for (const index of [0, 1]) {
      const username = `${tag}_${index}`;
      const email = `${username}@example.com`;
      const result = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } });
      check(result);
      if (!result.data.user) throw Error('Missing synthetic native CI user');
      users.push({ id: result.data.user.id, email, username });
    }
    check(await admin.from('groups').insert({ id: groupId, name: 'IMP synthetic playgroup', created_by: users[0].id }));
    check(await admin.from('group_members').upsert(users.map(user => ({ group_id: groupId, user_id: user.id })), { onConflict: 'group_id,user_id' }));
    for (const [index, user] of users.entries()) {
      const id = randomUUID();
      check(await admin.from('decks').insert({ id, user_id: user.id, group_id: null,
        source_type: 'manual', name: `IMP synthetic deck ${index + 1}`, commander: 'E2E Commander' }));
      decks.push(id);
    }
    const env = { ...process.env, MAESTRO_E2E_USERNAME: users[0].email, MAESTRO_E2E_PASSWORD: password,
      MAESTRO_PLAYER_1: users[0].username, MAESTRO_PLAYER_2: users[1].username,
      MAESTRO_METRO_URL: '', MAESTRO_RESUME_URL: `phyrexianarena-dev://table/${groupId}/play` };
    for (const flow of ['authenticated-live-game', 'authenticated-archive']) {
      const result = runMaestro(['test', '--debug-output', join(debug, flow), resolve(`expo/e2e/${flow}.yaml`)], { env, stdio: 'inherit' });
      if (result.error || result.status !== 0) throw Error(`Native CI attempt ${attempt} failed: ${flow}`);
    }
    const matches = await admin.from('matches').select('id,is_draw,match_participants(user_id,is_winner)').eq('group_id', groupId);
    check(matches);
    const match = matches.data?.[0];
    if (matches.data?.length !== 1 || !match.is_draw || match.match_participants.length !== 2
      || match.match_participants.some(row => row.is_winner || !users.some(user => user.id === row.user_id))
      || new Set(match.match_participants.map(row => row.user_id)).size !== 2) throw Error('Native CI saved-match oracle failed');
    const deck = await admin.from('decks').select('is_archived,source_type').eq('id', decks[0]).single();
    check(deck);
    if (deck.data.is_archived || deck.data.source_type !== 'manual') throw Error('Native CI restored-deck oracle failed');
    passed = true;
  } finally {
    let cleanupVerified = false;
    try {
      // Cleanup errors fail the core, even if UI commands succeeded.
      check(await admin.from('groups').delete().eq('id', groupId));
      const group = await admin.from('groups').select('id', { count: 'exact', head: true }).eq('id', groupId);
      check(group);
      if (group.count !== 0) throw Error('Native CI group cleanup failed');
      if (users.length) check(await admin.from('access_logs').delete().in('user_id', users.map(user => user.id)));
      for (const user of users) {
        check(await admin.auth.admin.deleteUser(user.id));
        const verify = await admin.auth.admin.getUserById(user.id);
        if (verify.data?.user || (verify.error && verify.error.status !== 404 && verify.error.code !== 'user_not_found')) {
          throw Error('Native CI account cleanup failed');
        }
      }
      cleanupVerified = true;
    } finally {
      // Always redact failure artifacts, including failures during cleanup.
      redact(debug, [password]);
      outcomes.push({ attempt, passed, cleanupVerified });
      writeFileSync(join(directory, 'proof.json'), JSON.stringify({ sha, apkSha256, package: 'com.phyrexianarena.app.dev', outcomes }, null, 2));
    }
  }
  console.log(`Native CI attempt ${attempt}/3 passed; saved match, restored deck and fixture cleanup verified.`);
}
