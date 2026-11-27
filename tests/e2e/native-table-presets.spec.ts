import {test, expect, type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {TablePresetSnapshot} from '../../lib/table-preset-controller';
declare global {interface Window {nativePresetHarness: {
  render: (actor?: string, group?: string, online?: boolean, token?: string) => void;
  configure: () => void; clear: () => void; omitCatalog: () => void; unmount: () => void;
  refresh: () => Promise<boolean>; save: (name: string) => Promise<boolean>; preview: (id: string) => Promise<boolean>;
  apply: () => Promise<boolean>; rename: (id: string, name: string) => Promise<boolean>; remove: (id: string) => Promise<boolean>; cancel: () => void;
};}}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let bundle: string;
test.beforeAll(async () => {
  const runtime = createRequire(resolve('expo/package.json')), toolchain = createRequire(resolve('node_modules/vitest/package.json'));
  const {build} = await import(pathToFileURL(toolchain.resolve('vite')).href) as {build: typeof import('vitest/node').Vite.build};
  const ports: Record<string, string> = {
    'expo-crypto': 'export const randomUUID=()=>crypto.randomUUID();',
    '@react-native-async-storage/async-storage': 'export default {getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>localStorage.setItem(key,value)};',
    '@/lib/deck-image-cache': 'export const prefetchDeckImageUrls=async()=>{};export const prefetchCommanderNames=async()=>{};',
  };
  const result = await build({configFile: false, root: resolve('expo'), logLevel: 'error',
    define: {'process.env.NODE_ENV': JSON.stringify('development')},
    resolve: {alias: [...Object.keys(ports).map(key => ({find: key, replacement: '\0native-preset:' + key})),
      {find: /^react$/, replacement: runtime.resolve('react')}, {find: /^react-dom\/client$/, replacement: runtime.resolve('react-dom/client')},
      {find: /^react-dom$/, replacement: runtime.resolve('react-dom')}, {find: '@', replacement: resolve('expo')}]},
    plugins: [{name: 'native-preset-ports', enforce: 'pre', resolveId: (name, importer) => {
      if (name.startsWith('\0native-preset:')) return name;
      if (name === './env' && importer?.endsWith('live-game-command-client.ts')) return '\0native-preset-env';
    }, load: name => name === '\0native-preset-env' ? 'export const getSupabaseUrl=()=>location.origin;export const getSupabaseAnonKey=()=>"fixture-public-key";' : ports[name.replace('\0native-preset:', '')]}],
    build: {write: false, minify: false, lib: {entry: resolve('expo/tests/fixtures/native-table-presets.tsx'), name: 'NativePreset', formats: ['iife']}}});
  const outputs = Array.isArray(result) ? result : [result];
  if (outputs.length !== 1 || !('output' in outputs[0])) throw Error('Unexpected native preset bundle');
  bundle = outputs[0].output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
});
async function state(page: Page): Promise<{snapshot: TablePresetSnapshot; life: number; revision: number; missing: number; participants: unknown[]}> {
  return JSON.parse((await page.getByTestId('native-preset-state').textContent())!);
}
async function open(page: Page, options: {hold?: boolean; missing?: boolean} = {}) {
  let reads = 0, writes = 0, aborted = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  page.on('requestfailed', request => {if (new URL(request.url()).pathname.endsWith('/groups')) aborted++;});
  await page.route('**/rest/v1/**', async route => {
    if (route.request().method() !== 'GET') {writes++; await route.abort(); return;}
    const table = new URL(route.request().url()).pathname.split('/').at(-1);
    let data: unknown = [];
    if (table === 'groups') {
      reads++; if (options.hold) await held;
      data = {id: id(2), group_members: [{user_id: id(1), profiles: {id: id(1), username: 'alice', display_name: 'Alice fresh'}}]};
    }
    if (table === 'decks') data = options.missing ? [] : [{id: id(3), user_id: id(1), group_id: id(2), name: 'Fresh A',
      commander: 'New A', commander_image: null, bracket: '3', source_type: 'occasional', is_archived: false}];
    if (table === 'arena_guests') data = [{id: id(4), group_id: id(2), display_name: 'Bob fresh'}];
    if (table === 'arena_guest_decks') data = [{id: id(5), guest_id: id(4), group_id: id(2), name: 'Fresh B', commander: 'New B', commander_image: null, bracket: null}];
    await route.fulfill({json: data}).catch(() => {});
  });
  await page.route('**/__native_presets', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><div id="root"></div><script src="/__native_presets.js"></script>'}));
  await page.route('**/__native_presets.js', route => route.fulfill({contentType: 'text/javascript', body: bundle}));
  await page.goto('/__native_presets'); await page.evaluate(() => window.nativePresetHarness.render());
  await expect(page.getByTestId('native-preset-state')).toContainText(`"ready":"${id(1)}:${id(2)}"`);
  await page.evaluate(() => window.nativePresetHarness.configure());
  return {reads: () => reads, writes: () => writes, aborted: () => aborted, release};
}
async function save(page: Page) {
  expect(await page.evaluate(() => window.nativePresetHarness.save('Friday'))).toBe(true);
  await expect.poll(async () => (await state(page)).snapshot.presets.length).toBe(1);
  return (await state(page)).snapshot.presets[0].id;
}
test('native preset hooks CRUD/restart and fresh bounded projection preserve manual confirmation', async ({page}) => {
  const probe = await open(page); const savedId = await save(page);
  await page.evaluate(() => {window.nativePresetHarness.clear(); window.nativePresetHarness.omitCatalog();});
  expect(await page.evaluate(id => window.nativePresetHarness.preview(id), savedId)).toBe(true);
  expect(probe.reads()).toBe(0); expect((await state(page)).life).toBe(20);
  expect(await page.evaluate(() => window.nativePresetHarness.apply())).toBe(true);
  await expect.poll(async () => (await state(page)).revision).toBe(1);
  expect(await state(page)).toMatchObject({life: 30, missing: 0});
  await expect(page.getByTestId('native-preset-state')).toContainText('Alice fresh');
  await expect(page.getByTestId('native-preset-state')).toContainText('Fresh A');
  await expect(page.getByTestId('native-preset-state')).toContainText('"source_type":"occasional"');
  expect(await page.evaluate(id => window.nativePresetHarness.rename(id, 'Saturday'), savedId)).toBe(true);
  await page.reload(); await page.evaluate(() => window.nativePresetHarness.render());
  expect(await page.evaluate(() => window.nativePresetHarness.refresh())).toBe(true);
  await expect.poll(async () => (await state(page)).snapshot.presets[0]?.name).toBe('Saturday');
  expect(await page.evaluate(id => window.nativePresetHarness.remove(id), savedId)).toBe(true);
  await expect.poll(async () => (await state(page)).snapshot.presets.length).toBe(0);
  expect(probe.writes()).toBe(0);
});
test('native preset hooks keep missing decks unassigned and renew JWT without clearing setup', async ({page}) => {
  const probe = await open(page, {missing: true}); const savedId = await save(page);
  await page.evaluate(() => window.nativePresetHarness.render(undefined, undefined, true, 'renewed-token'));
  expect(await page.evaluate(id => window.nativePresetHarness.preview(id), savedId)).toBe(true);
  expect(await page.evaluate(() => window.nativePresetHarness.apply())).toBe(true);
  await expect.poll(async () => (await state(page)).missing).toBe(1);
  expect((await state(page)).life).toBe(30); expect(probe.writes()).toBe(0);
});
for (const transition of ['close', 'account', 'group', 'unmount'] as const) test(`native preset hooks discard late validation on ${transition}`, async ({page}) => {
  const probe = await open(page, {hold: true});
  try {
    const savedId = await save(page); await page.evaluate(() => window.nativePresetHarness.clear());
    expect(await page.evaluate(id => window.nativePresetHarness.preview(id), savedId)).toBe(true);
    await page.evaluate(() => {void window.nativePresetHarness.apply();});
    await expect.poll(probe.reads).toBe(1);
    await page.evaluate(({transition, actor, group}) => {
      if (transition === 'close') window.nativePresetHarness.cancel();
      else if (transition === 'unmount') window.nativePresetHarness.unmount();
      else window.nativePresetHarness.render(actor, group);
    }, {transition, actor: transition === 'account' ? id(9) : id(1), group: transition === 'group' ? id(8) : id(2)});
    await expect.poll(probe.aborted).toBe(1); probe.release();
    if (transition !== 'unmount') {
      await expect.poll(async () => (await state(page)).revision).toBe(0);
      expect((await state(page)).life).not.toBe(30);
      if (transition !== 'close') expect((await state(page)).snapshot.presets).toEqual([]);
    }
    expect(probe.writes()).toBe(0);
  } finally {probe.release();}
});
