import {expect, type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {RecapHarness} from '../fixtures/arena-recap-io';

export const recapId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Filters = {p_since: string; p_until: string; p_group_id: string; p_day_key: null; p_boundary_hour: number};
export async function buildRecapHarness(platform: 'web' | 'native') {
  const native = platform === 'native', root = resolve(native ? 'expo' : '.');
  const runtime = createRequire(resolve(native ? 'expo/package.json' : 'package.json'));
  const toolchain = createRequire(resolve('node_modules/vitest/package.json'));
  const {build} = await import(pathToFileURL(toolchain.resolve('vite')).href) as {build: typeof import('vitest/node').Vite.build};
  const ports: Record<string, string> = native ? {
    '@/contexts/language-context': 'export const useLanguage=()=>({language:window.recapLanguage});',
    'react-native': 'export const Share={dismissedAction:"dismissedAction",sharedAction:"sharedAction",share:payload=>window.arenaRecapIo.nativeShare(payload)};',
  } : {
    '@/components/language-provider': 'export const useLanguage=()=>({language:window.recapLanguage});',
    '@/lib/supabase': 'export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:window.recapActor},access_token:"fixture-token"}},error:null})}};',
  };
  const result = await build({configFile: false, root, logLevel: 'error',
    define: {'process.env.NODE_ENV': JSON.stringify('development'), 'process.env.NEXT_PUBLIC_SUPABASE_URL': 'location.origin',
      'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify('fixture-public-key')},
    resolve: {alias: [...Object.keys(ports).map(key => ({find: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: '\0recap:' + key})),
      {find: /^react$/, replacement: runtime.resolve('react')}, {find: /^react-dom\/client$/, replacement: runtime.resolve('react-dom/client')},
      {find: /^react-dom$/, replacement: runtime.resolve('react-dom')}, {find: '@', replacement: root}]},
    plugins: [{name: 'recap-io', enforce: 'pre', resolveId: (name, importer) => {
      if (name.startsWith('\0recap:')) return name;
      if (name === './env' && importer?.endsWith('live-game-command-client.ts')) return '\0recap-env';
    }, load: name => name === '\0recap-env' ? 'export const getSupabaseUrl=()=>location.origin;export const getSupabaseAnonKey=()=>"fixture-public-key";' : ports[name.replace('\0recap:', '')]}],
    build: {write: false, minify: false, lib: {entry: resolve(native ? 'expo/tests/fixtures/native-arena-recap.tsx' : 'tests/fixtures/web-arena-recap.tsx'), name: 'ArenaRecap', formats: ['iife']}}});
  const outputs = Array.isArray(result) ? result : [result];
  if (outputs.length !== 1 || !('output' in outputs[0])) throw Error('Unexpected recap bundle');
  return outputs[0].output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
}
function response(args: Filters, large: boolean) {
  const total = large ? 5001 : 2, count = large ? 100 : 2;
  const playedAt = new Date(Date.parse(args.p_since) + 12 * 3600000).toISOString();
  const matches = Array.from({length: count}, (_, index) => {
    const id = recapId(10000 - index), draw = index === 1;
    return {id, group_id: args.p_group_id, created_by: recapId(1), played_at: playedAt, arena_day_key: playedAt.slice(0, 10),
      notes: 'PRIVATE_NOTES', winner_id: draw ? null : recapId(1), winner_guest_id: null, is_draw: draw,
      duration_seconds: 120 + index * 120, tracking_version: 1, invite_code: 'PRIVATE_CODE', live_game_log: ['PRIVATE_LOG'],
      match_participants: [
        {id: recapId(20000 + index * 2), match_id: id, user_id: recapId(1), guest_id: null, deck_id: recapId(3), guest_deck_id: null,
          is_winner: !draw, participant_name_snapshot: 'Alice private', commander_snapshot: 'Commander Alpha', profiles: {email: 'secret@example.test'}},
        {id: recapId(20001 + index * 2), match_id: id, user_id: null, guest_id: recapId(4), deck_id: null, guest_deck_id: recapId(5),
          is_winner: false, participant_name_snapshot: 'Bob private', commander_snapshot: 'Commander Beta'},
      ]};
  });
  const last = matches.at(-1)!;
  return {schemaVersion: 2, complete: true, asOf: new Date().toISOString(), groupId: args.p_group_id, revision: 'a'.repeat(32), total,
    filters: {since: args.p_since, until: args.p_until, dayKey: null, boundaryHour: 0}, matches,
    next: large ? {id: last.id, playedAt: last.played_at} : null};
}
export async function openRecapHarness(page: Page, bundle: string, options: {hold?: boolean; failure?: 'forbidden' | 'schema' | 'large'} = {}) {
  let reads = 0, writes = 0, aborted = 0, failure = options.failure;
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;}), requests: Filters[] = [];
  page.on('requestfailed', request => {if (new URL(request.url()).pathname.endsWith('/rpc/get_arena_history_page_v2')) aborted++;});
  await page.route('**/rest/v1/**', async route => {
    if (!new URL(route.request().url()).pathname.endsWith('/rpc/get_arena_history_page_v2')) {writes++; await route.abort(); return;}
    const args = route.request().postDataJSON() as Filters; requests.push(args); reads++;
    if (options.hold && reads === 1) await held;
    if (failure === 'forbidden') {await route.fulfill({status: 403, json: {code: '42501', message: 'PRIVATE_SQL_ERROR'}}).catch(() => {}); return;}
    const data = response(args, failure === 'large');
    await route.fulfill({json: failure === 'schema' ? {...data, schemaVersion: 1} : data}).catch(() => {});
  });
  await page.route('**/__arena_recap', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><div id="root"></div><script src="/__arena_recap.js"></script>'}));
  await page.route('**/__arena_recap.js', route => route.fulfill({contentType: 'text/javascript', body: bundle}));
  await page.goto('/__arena_recap'); await page.evaluate(() => window.arenaRecapHarness.render());
  return {reads: () => reads, writes: () => writes, aborted: () => aborted, requests, release,
    recover: () => {failure = undefined;}};
}
export async function recapStats(page: Page): Promise<ReturnType<RecapHarness['stats']>> {
  return page.evaluate(() => window.arenaRecapHarness.stats());
}
export function expectPrivateFieldsAbsent(text: string) {
  for (const secret of ['PRIVATE_NOTES', 'PRIVATE_CODE', 'PRIVATE_LOG', 'PRIVATE_SQL_ERROR', 'secret@example.test', recapId(1), recapId(2), 'https://']) expect(text).not.toContain(secret);
}
