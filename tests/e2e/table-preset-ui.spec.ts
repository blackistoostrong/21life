import {test, expect, type Page, type Route} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

declare global {interface Window {tablePresetUiHarness: {
  render: (actor?: string, group?: string, language?: string, online?: boolean) => void;
  configure: () => void; clear: () => void; omitCatalog: () => void; unmount: () => void;
};}}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const storageKey = `phyrexian-arena:table-presets:v1:${id(1)}:${id(2)}`;
let bundle: string;
test.beforeAll(async () => {
  const runtime = createRequire(resolve('package.json'));
  const toolchain = createRequire(resolve('node_modules/vitest/package.json'));
  const {build} = await import(pathToFileURL(toolchain.resolve('vite')).href) as {build: typeof import('vitest/node').Vite.build};
  const ports: Record<string, string> = {
    '@/components/language-provider': 'export const useLanguage=()=>({language:window.presetLanguage,copy:label=>label[window.presetLanguage]});',
    '@/lib/supabase': 'export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:window.presetActor},access_token:"fixture-token"}},error:null})}};',
  };
  const result = await build({configFile: false, root: resolve('.'), logLevel: 'error',
    define: {'process.env.NODE_ENV': JSON.stringify('development'), 'process.env.NEXT_PUBLIC_SUPABASE_URL': 'location.origin',
      'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify('fixture-public-key')},
    resolve: {alias: [...Object.keys(ports).map(key => ({find: key, replacement: '\0preset-ui:' + key})),
      {find: /^react$/, replacement: runtime.resolve('react')}, {find: /^react-dom\/client$/, replacement: runtime.resolve('react-dom/client')},
      {find: /^react-dom$/, replacement: runtime.resolve('react-dom')}, {find: '@', replacement: resolve('.')}]},
    plugins: [{name: 'preset-ui-ports', enforce: 'pre', resolveId: name => name.startsWith('\0preset-ui:') ? name : undefined,
      load: name => ports[name.replace('\0preset-ui:', '')]}],
    build: {write: false, minify: false, lib: {entry: resolve('tests/fixtures/web-table-presets.tsx'), name: 'TablePresetUi', formats: ['iife']}}});
  const outputs = Array.isArray(result) ? result : [result];
  if (outputs.length !== 1 || !('output' in outputs[0])) throw Error('Unexpected preset UI bundle');
  bundle = outputs[0].output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
});
async function open(page: Page, options: {missingDeck?: boolean; missingGuest?: boolean; archived?: boolean; hold?: boolean} = {}) {
  let reads = 0, writes = 0, aborted = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  page.on('requestfailed', request => {if (new URL(request.url()).pathname.endsWith('/groups')) aborted++;});
  await page.route('**/rest/v1/**', async (route: Route) => {
    if (route.request().method() !== 'GET') {writes++; await route.abort(); return;}
    const table = new URL(route.request().url()).pathname.split('/').at(-1);
    let data: unknown = [];
    if (table === 'groups') {
      reads++; if (options.hold) await held;
      data = {id: id(2), group_members: [{user_id: id(1), profiles: {id: id(1), username: 'alice', display_name: 'Alice fresh'}}]};
    }
    if (table === 'decks') data = options.missingDeck ? [] : [{id: id(3), user_id: id(1), group_id: id(2),
      name: 'Fresh A', commander: 'New A', commander_image: null, bracket: '3', source_type: 'occasional', is_archived: Boolean(options.archived)}];
    if (table === 'arena_guests') data = options.missingGuest ? [] : [{id: id(4), group_id: id(2), display_name: 'Bob fresh'}];
    if (table === 'arena_guest_decks') data = [{id: id(5), guest_id: id(4), group_id: id(2), name: 'Fresh B', commander: 'New B', commander_image: null, bracket: null}];
    await route.fulfill({json: data}).catch(() => {});
  });
  await page.route('**/__preset_ui', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><div id="root"></div><script src="/__preset_ui.js"></script>'}));
  await page.route('**/__preset_ui.js', route => route.fulfill({contentType: 'text/javascript', body: bundle}));
  await page.goto('/__preset_ui');
  await page.evaluate(() => {window.tablePresetUiHarness.render(); window.tablePresetUiHarness.configure();});
  return {reads: () => reads, writes: () => writes, aborted: () => aborted, release};
}
async function save(page: Page, name = 'Friday') {
  await page.getByRole('button', {name: 'Table presets', exact: true}).click();
  await page.getByLabel('Preset name', {exact: true}).fill(name);
  await page.getByRole('button', {name: 'Save current setup', exact: true}).click();
  await expect(page.getByRole('button', {name: `Load ${name}`, exact: true})).toBeVisible();
}
test('preset UI saves, persists after restart, renames and requires deletion confirmation', async ({page}) => {
  await open(page); await save(page);
  await page.getByRole('button', {name: 'Close', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Table presets', exact: true})).toBeFocused();
  await page.reload(); await page.evaluate(() => window.tablePresetUiHarness.render());
  await page.getByRole('button', {name: 'Table presets', exact: true}).click();
  await page.getByRole('button', {name: 'Rename Friday', exact: true}).click();
  await page.getByLabel('Preset name', {exact: true}).fill('Saturday');
  await page.getByRole('button', {name: 'Rename', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Load Saturday', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Delete Saturday', exact: true}).click();
  expect(JSON.parse((await page.evaluate(key => localStorage.getItem(key), storageKey))!).presets).toHaveLength(1);
  await page.getByRole('button', {name: 'Confirm deletion', exact: true}).click();
  await expect(page.getByText('No saved presets.', {exact: true})).toBeVisible();
});
test('preset preview does no lookup or start; confirmed apply resolves references beyond picker limits', async ({page}) => {
  const probe = await open(page); await save(page);
  await page.evaluate(() => {window.tablePresetUiHarness.clear(); window.tablePresetUiHarness.omitCatalog();});
  await page.getByRole('button', {name: 'Load Friday', exact: true}).click();
  expect(probe.reads()).toBe(0);
  await expect(page.getByTestId('preset-setup')).toContainText('"life":20');
  await page.getByRole('button', {name: 'Apply to setup', exact: true}).click();
  await expect(page.getByTestId('preset-setup')).toContainText('"life":30');
  await expect(page.getByTestId('preset-setup')).toContainText('"step":3');
  await expect(page.getByTestId('preset-setup')).toContainText('Alice fresh');
  await expect(page.getByTestId('preset-setup')).toContainText('Fresh A');
  await expect(page.getByTestId('preset-setup')).toContainText('"isOccasional":true');
  expect(probe.reads()).toBe(1); expect(probe.writes()).toBe(0);
});
for (const failure of ['missingDeck', 'missingGuest', 'archived'] as const) test(`preset apply clears ${failure} without substitution or writes`, async ({page}) => {
  const probe = await open(page, {[failure]: true}); await save(page);
  await page.getByRole('button', {name: 'Load Friday', exact: true}).click();
  await page.getByRole('button', {name: 'Apply to setup', exact: true}).click();
  await expect(page.getByTestId('preset-setup')).toContainText('"missing":1');
  await expect(page.getByTestId('preset-setup')).toContainText(failure === 'missingGuest'
    ? '"participantKey":null,"deckId":null' : `"participantKey":"user:${id(1)}","deckId":null`);
  expect(probe.writes()).toBe(0);
});
for (const transition of ['close', 'account', 'group', 'unmount'] as const) test(`preset validation ignores late replies on ${transition}`, async ({page}) => {
  const probe = await open(page, {hold: true});
  try {
    await save(page); await page.evaluate(() => window.tablePresetUiHarness.clear());
    await page.getByRole('button', {name: 'Load Friday', exact: true}).click();
    await page.getByRole('button', {name: 'Apply to setup', exact: true}).click();
    await expect.poll(probe.reads).toBe(1);
    if (transition === 'close') await page.getByRole('button', {name: 'Close', exact: true}).click();
    else await page.evaluate(({transition, actor, group}) => {
      if (transition === 'unmount') window.tablePresetUiHarness.unmount();
      else window.tablePresetUiHarness.render(actor, group);
    }, {transition, actor: transition === 'account' ? id(9) : id(1), group: transition === 'group' ? id(8) : id(2)});
    await expect.poll(probe.aborted).toBe(1); probe.release();
    if (transition !== 'unmount') {
      await expect(page.getByTestId('preset-setup')).not.toContainText('Alice fresh');
      await expect(page.getByTestId('preset-setup')).not.toContainText('"life":30');
    }
    expect(probe.writes()).toBe(0);
  } finally {probe.release();}
});
test('preset UI handles invalid and duplicate names, future schema, and Italian labels without changing setup', async ({page}) => {
  await open(page); await save(page);
  await page.getByLabel('Preset name', {exact: true}).fill(' friday ');
  await page.getByRole('button', {name: 'Save current setup', exact: true}).click();
  await expect(page.getByRole('alert')).toHaveText('A preset with this name already exists.');
  await page.getByLabel('Preset name', {exact: true}).fill(' ');
  await page.getByRole('button', {name: 'Save current setup', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('1–40 characters');
  await page.getByRole('button', {name: 'Close', exact: true}).click();
  const future = '{"schemaVersion":99,"privateFuture":"preserve"}';
  await page.evaluate(({key, future}) => localStorage.setItem(key, future), {key: storageKey, future});
  await page.evaluate(() => window.tablePresetUiHarness.render(undefined, undefined, 'it'));
  await page.getByRole('button', {name: 'Preset del tavolo', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('versione più recente');
  await page.getByLabel('Nome preset', {exact: true}).fill('Venerdì');
  await page.getByRole('button', {name: 'Salva configurazione attuale', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('versione più recente');
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(future);
  await expect(page.getByTestId('preset-setup')).toContainText('"life":30');
});
test('preset dialog supports keyboard entry, Escape and local-storage failures without losing setup', async ({page}) => {
  const probe = await open(page);
  const trigger = page.getByRole('button', {name: 'Table presets', exact: true});
  await trigger.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', {name: 'Table presets', exact: true})).toBeVisible();
  const input = page.getByLabel('Preset name', {exact: true});
  await input.fill('Keyboard'); await input.press('Enter');
  await expect(page.getByRole('button', {name: 'Load Keyboard', exact: true})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('phyrexian-arena:table-presets:')) throw new DOMException('Blocked', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await trigger.click(); await input.fill('Blocked');
  await page.getByRole('button', {name: 'Save current setup', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Local storage is unavailable.');
  await expect(page.getByTestId('preset-setup')).toContainText('"life":30');
  expect(probe.reads()).toBe(0); expect(probe.writes()).toBe(0);
});
test('preset form and list disappear immediately when another account opens the setup', async ({page}) => {
  await open(page); await save(page);
  await page.getByLabel('Preset name', {exact: true}).fill('Private draft');
  await page.evaluate(actor => window.tablePresetUiHarness.render(actor), id(9));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', {name: 'Table presets', exact: true}).click();
  await expect(page.getByLabel('Preset name', {exact: true})).toHaveValue('');
  await expect(page.getByText('No saved presets.', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Load Friday', exact: true})).toHaveCount(0);
});
