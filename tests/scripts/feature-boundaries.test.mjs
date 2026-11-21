import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { verifyFeatureBoundaries } from '../../scripts/verify-feature-boundaries.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), '21life-features-'));
  const put = (file, source) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  };
  const owners = { web: ['entry.ts'], native: ['expo/entry.ts'], presentation: [] };
  const verify = () => verifyFeatureBoundaries(root, ts, owners);
  try {
    mkdirSync(join(root, 'packages/data'), { recursive: true });
    put('tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }));
    put('expo/tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }));
    put('entry.ts', 'export const web = 1;');
    put('expo/entry.ts', 'export const native = 1;');
    run({ put, owners, verify });
  } finally {
    rmSync(root, { recursive: true });
  }
}

test('feature gate accepts pure transports, type-only imports and per-platform aliases', () => fixture(({ put, verify }) => {
  put('packages/domain/values.ts', 'export const value = 1;');
  put('packages/data/query.ts', "export { value } from '../domain/values';");
  put('entry.ts', "import type { X } from 'react-native'; export * from './packages/data/query';");
  put('expo/entry.ts', "export * from '@/lib/value';");
  put('expo/lib/value.ts', 'export const value = 1;');
  assert.deepEqual(verify(), []);
}));

test('data gate rejects UI, SDK, aliases and computed module access', () => fixture(({ put, verify }) => {
  for (const source of ["import '../..//components/panel';", "import '@supabase/supabase-js';",
    "export * from '@/lib/query';", "import type { Props } from '../../components/panel';",
    'import(moduleName);', 'require(moduleName);']) {
    put('packages/data/query.ts', source);
    assert.ok(verify().some((error) => error.includes('data dependency outside')));
  }
}));

test('web runtime gate follows barrels, dynamic imports and require into native code', () => fixture(({ put, verify }) => {
  put('lib/bridge.ts', "export * from './nested';");
  put('lib/nested.ts', "import 'expo-file-system';");
  for (const source of ["export * from './lib/bridge';", "import('./lib/bridge');", "require('./lib/bridge');",
    "import bridge = require('./lib/bridge');"]) {
    put('entry.ts', source);
    assert.ok(verify().some((error) => error.includes('forbidden runtime expo-file-system')));
  }
}));

test('platform UI boundaries and native Next runtime imports are rejected', () => fixture(({ put, verify }) => {
  put('entry.ts', "import './expo/components/panel';");
  put('expo/components/panel.ts', 'export const panel = 1;');
  put('expo/entry.ts', "import '../components/panel'; import '@/lib/bridge';");
  put('components/panel.ts', 'export const panel = 1;');
  put('expo/lib/bridge.ts', "import 'next/navigation';");
  const errors = verify();
  assert.ok(errors.some((error) => error.includes('web imports other platform UI')));
  assert.ok(errors.some((error) => error.includes('native imports other platform UI')));
  assert.ok(errors.some((error) => error.includes('native imports forbidden runtime next/navigation')));
}));

test('feature gate reports complete runtime cycle paths but permits type cycles', () => fixture(({ put, verify }) => {
  put('entry.ts', "export * from './lib/a';");
  put('lib/a.ts', "export * from './b';");
  put('lib/b.ts', "export * from './a';");
  assert.ok(verify().some((error) => /lib\/a.ts -> lib\/b.ts -> lib\/a.ts/.test(error)));
  put('lib/b.ts', "import type { A } from './a'; export type B = A;");
  assert.deepEqual(verify(), []);
}));

test('presentation cannot hide a data client behind a local wrapper or runtime barrel', () => fixture(({ put, owners, verify }) => {
  owners.presentation = ['components/panel.ts'];
  put('components/panel.ts', "export * from '../lib/wrapper';");
  put('lib/wrapper.ts', "export * from './supabase';");
  put('lib/supabase.ts', "import '@supabase/supabase-js';");
  assert.ok(verify().some((error) => error.includes('presentation reaches data/journal owner lib/supabase.ts')));
  put('components/panel.ts', "import type { X } from '../lib/supabase'; export const panel = 1;");
  assert.deepEqual(verify(), []);
}));

test('an explicit independent container delegate does not permit direct panel SDK access', () => fixture(({ put, owners, verify }) => {
  owners.presentation = ['components/panel.ts'];
  owners.delegates = { 'components/panel.ts': ['components/image-container.ts'] };
  put('components/panel.ts', "export * from './image-container';");
  put('components/image-container.ts', "export * from '../lib/supabase';");
  put('lib/supabase.ts', "import '@supabase/supabase-js';");
  assert.deepEqual(verify(), []);
  put('components/panel.ts', "export * from './image-container'; import '../lib/supabase';");
  assert.ok(verify().some((error) => error.includes('presentation reaches data/journal owner')));
}));

test('computed runtime module access is rejected even through a helper', () => fixture(({ put, verify }) => {
  put('entry.ts', "export * from './lib/bridge';");
  put('lib/bridge.ts', 'require(moduleName);');
  assert.ok(verify().some((error) => error.includes('non-static runtime module access')));
}));
