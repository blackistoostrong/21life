import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNodeCommand } from '../../scripts/qa-command.mjs';

for (const code of [0, 7]) {
  test(`QA child command preserves exit code ${code}`, async () => {
    assert.equal(await runNodeCommand(['-e', `process.exit(${code})`], { stdio: 'ignore' }), code);
  });
}
test('QA child wait keeps parent timers and I/O event processing responsive', async () => {
  let parentTimerFired = false;
  const timer = setTimeout(() => { parentTimerFired = true; }, 10);
  try {
    assert.equal(await runNodeCommand(['-e', 'setTimeout(() => process.exit(0), 200)'], { stdio: 'ignore' }), 0);
    assert.equal(parentTimerFired, true);
  } finally { clearTimeout(timer); }
});
test('QA child spawn errors reject rather than reporting a successful command', async () => {
  await assert.rejects(runNodeCommand(['-e', 'process.exit(0)'], {
    cwd: join(tmpdir(), '21life-nonexistent-' + randomUUID()), stdio: 'ignore',
  }), { code: 'ENOENT' });
});
