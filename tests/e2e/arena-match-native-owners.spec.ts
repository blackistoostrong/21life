import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

type Harness = {
  render: (actor?: string, opening?: boolean) => void; start: () => void;
  reply: (index: number, outcome: 'ok' | 'error' | 'bad-ack') => void;
  snapshot: () => { successes: number; failures: number; calls: Array<{ args: Record<string, unknown>; aborted: boolean }> };
  settle: () => Promise<void>; unmount: () => void;
};
declare global { interface Window { nativeMatchTest: Harness } }
let bundle: string;
test.beforeAll(async () => {
  // Reuse the bundler of the installed, pinned Vitest toolchain. Vitest 5's
  // Vite namespace exists in its declarations but is absent at runtime.
  const toolchainRequire = createRequire(resolve('node_modules/vitest/package.json'));
  const { build } = await import(pathToFileURL(toolchainRequire.resolve('vite')).href) as {
    build: typeof import('vitest/node').Vite.build;
  };
  const nativeRequire = createRequire(resolve('expo/package.json'));
  const result = await build({ configFile: false, root: resolve('expo'), logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: { alias: [
      { find: '@/lib/supabase', replacement: '\0native-match-test-sdk' },
      { find: 'expo-crypto', replacement: '\0native-match-test-rng' },
      { find: /^react$/, replacement: nativeRequire.resolve('react') },
      { find: /^react-dom\/client$/, replacement: nativeRequire.resolve('react-dom/client') },
      { find: /^react-dom$/, replacement: nativeRequire.resolve('react-dom') },
      { find: '@', replacement: resolve('expo') },
    ] },
    plugins: [{ name: 'native-match-test-ports', enforce: 'pre',
      resolveId(id) {
        if (id === '\0native-match-test-sdk' || id === '\0native-match-test-rng') return id;
      },
      load(id) {
        if (id === '\0native-match-test-sdk') return 'export const supabase = {rpc: (...args) => window.nativeMatchTestPort.rpc(...args)};';
        if (id === '\0native-match-test-rng') return 'export const randomUUID = () => crypto.randomUUID();';
      },
    }],
    build: { write: false, minify: false, lib: { entry: resolve('tests/e2e/fixtures/native-match-owners.ts'), name: 'NativeMatchOwners', formats: ['iife'] } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  if (outputs.length !== 1 || !('output' in outputs[0])) throw new Error('Expected one native owner test bundle');
  bundle = outputs[0].output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
});
async function openHarness(page: Page) {
  await page.route('**/__native_match_owners', route => route.fulfill({ contentType: 'text/html',
    body: '<div id="root"></div><script src="/__native_match_owners.js"></script>' }));
  await page.route('**/__native_match_owners.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle }));
  await page.goto('/__native_match_owners');
  await page.evaluate(() => window.nativeMatchTest.render());
  await expect(page.getByTestId('busy')).toHaveText('false');
}

test('native match React owners block duplicates and preserve retry identity until success', async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => { window.nativeMatchTest.start(); window.nativeMatchTest.start(); });
  await expect(page.getByTestId('busy')).toHaveText('true');
  expect((await page.evaluate(() => window.nativeMatchTest.snapshot())).calls).toHaveLength(1);
  await page.evaluate(async () => { window.nativeMatchTest.reply(0, 'error'); await window.nativeMatchTest.settle(); });
  await expect(page.getByTestId('busy')).toHaveText('false');
  await page.evaluate(() => window.nativeMatchTest.start());
  let snapshot = await page.evaluate(() => window.nativeMatchTest.snapshot());
  expect(snapshot.failures).toBe(1);
  expect(snapshot.calls[0].args.p_match_id).toBe(snapshot.calls[1].args.p_match_id);
  expect(snapshot.calls[1].args).toMatchObject({ p_actor_id: 'actor-a', p_group_id: 'group', p_create: true });
  await page.evaluate(async () => { window.nativeMatchTest.reply(1, 'ok'); await window.nativeMatchTest.settle(); });
  await expect(page.getByTestId('busy')).toHaveText('false');
  await page.evaluate(() => window.nativeMatchTest.start());
  snapshot = await page.evaluate(() => window.nativeMatchTest.snapshot());
  expect(snapshot.successes).toBe(1);
  expect(snapshot.calls[2].args.p_match_id).not.toBe(snapshot.calls[1].args.p_match_id);
  await page.evaluate(async () => { window.nativeMatchTest.reply(2, 'ok'); await window.nativeMatchTest.settle(); });
});

for (const departure of ['close', 'account', 'unmount'] as const) test(`native match React owners cancel ${departure} and discard late feedback`, async ({ page }) => {
  await openHarness(page); await page.evaluate(() => window.nativeMatchTest.start());
  await expect(page.getByTestId('busy')).toHaveText('true');
  await page.evaluate(departure => {
    if (departure === 'unmount') window.nativeMatchTest.unmount();
    else window.nativeMatchTest.render(departure === 'account' ? 'actor-b' : 'actor-a', departure !== 'close');
  }, departure);
  await page.evaluate(() => window.nativeMatchTest.settle());
  let snapshot = await page.evaluate(() => window.nativeMatchTest.snapshot());
  expect(snapshot.calls[0].aborted).toBe(true); expect(snapshot.successes).toBe(0); expect(snapshot.failures).toBe(0);
  if (departure !== 'unmount') {
    await page.evaluate(() => window.nativeMatchTest.render());
    await expect(page.getByTestId('busy')).toHaveText('false');
    await page.evaluate(() => window.nativeMatchTest.start());
    snapshot = await page.evaluate(() => window.nativeMatchTest.snapshot());
    expect(snapshot.calls).toHaveLength(2);
    expect(snapshot.calls[1].args.p_match_id).not.toBe(snapshot.calls[0].args.p_match_id);
    await page.evaluate(async () => { window.nativeMatchTest.reply(0, 'ok'); window.nativeMatchTest.reply(1, 'ok'); await window.nativeMatchTest.settle(); });
    snapshot = await page.evaluate(() => window.nativeMatchTest.snapshot());
    expect(snapshot.successes).toBe(1); expect(snapshot.failures).toBe(0);
  }
});
