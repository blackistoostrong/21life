import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { verifyDomainBoundaries } from '../../scripts/verify-domain-boundaries.mjs';

test('domain gate rejects runtime imports, ambient platform access and cycles', () => {
  const dir = mkdtempSync(join(tmpdir(), '21life-domain-'));
  try {
    writeFileSync(join(dir, 'a.ts'), 'export const x = 1;');
    assert.deepEqual(verifyDomainBoundaries(dir, ts), []);
    for (const source of ["import x from 'react-native';", 'const x = process.env.KEY;', "export * from './b';"]) {
      writeFileSync(join(dir, 'a.ts'), source);
      writeFileSync(join(dir, 'b.ts'), "export * from './a';");
      assert.ok(verifyDomainBoundaries(dir, ts).length > 0);
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('domain gate rejects ambient clocks and random generators but accepts injected inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), '21life-domain-time-'));
  try {
    for (const source of ['export const x = new Date();', 'export const x = Date.now();',
      'export const random = Math.random;', 'export const x = Date();']) {
      writeFileSync(join(dir, 'a.ts'), source);
      assert.ok(verifyDomainBoundaries(dir, ts).some(error => error.includes('ambient clock/random')));
    }
    writeFileSync(join(dir, 'a.ts'), "export const parse = (value: string) => new Date(value); export const choose = (random: () => number) => Math.floor(random() * 4);");
    assert.deepEqual(verifyDomainBoundaries(dir, ts), []);
  } finally { rmSync(dir, { recursive: true }); }
});
