import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const origin = 'https://21life.win';
const calls = [];
const env = { DB: { prepare(sql) { return { bind(event) { return { async run() { calls.push({ sql, event }); } }; } }; } } };
function req(event, options = {}) { return new Request('https://counter.example/click', { method: 'POST', headers: { Origin: origin, ...options.headers }, body: event }); }
test('records only supported events from the site and acknowledges after the atomic write', async () => {
  for (const event of ['apk', 'web']) assert.equal((await worker.fetch(req(event), env)).status, 204);
  assert.deepEqual(calls.map(x => x.event), ['apk', 'web']);
  assert.match(calls[0].sql, /ON CONFLICT\(day, event\) DO UPDATE SET count = count \+ 1/);
});
test('rejects untrusted origins, unsupported actions and oversized bodies', async () => {
  assert.equal((await worker.fetch(req('apk', {headers:{Origin:'https://example.com'}}), env)).status, 403);
  assert.equal((await worker.fetch(req('other'), env)).status, 400);
  assert.equal((await worker.fetch(req('x'.repeat(17)), env)).status, 400);
  assert.equal(calls.length, 2);
});
test('reports storage failures instead of silently counting', async () => {
  const failing={DB:{prepare(){return {bind(){return {async run(){throw Error('unavailable')}}}}}}};
  assert.equal((await worker.fetch(req('apk'), failing)).status, 503);
});

// Run the actual browser client against a minimal DOM without sending events.
test('browser client recognizes renamed and cached legacy APK links only', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const handlers = new Map();
  const sent = [];
  class Element { constructor(href) { this.href = href; } closest() { return this; } }
  runInNewContext(readFileSync(new URL('./site-client.js', import.meta.url), 'utf8'), {
    location: { hostname: '21life.win' }, URL, Element,
    document: { addEventListener(name, fn) { handlers.set(name, fn); } },
    navigator: { sendBeacon(endpoint, type) { sent.push({ endpoint, type }); return true; } },
  });
  for (const owner of ['blackistoostrong', 'marco201091-glitch']) {
    handlers.get('click')({ target: new Element(`https://github.com/${owner}/21life/releases/download/v9.2.1/21life-v9.2.1.apk`) });
  }
  handlers.get('click')({ target: new Element('https://github.com/unrelated/21life/releases/download/v9.2.1/21life-v9.2.1.apk') });
  handlers.get('click')({ target: new Element('https://app.21life.win/') });
  assert.deepEqual(sent.map(x => x.type), ['apk', 'apk', 'web']);
  assert.ok(sent.every(x => x.endpoint === 'https://21life-clicks.21life-stats.workers.dev/click'));
});
