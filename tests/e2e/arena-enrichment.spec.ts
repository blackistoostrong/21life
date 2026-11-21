import { expect, test, type Page } from '@playwright/test';
import { transitionFixtureSession } from './profile-auth-fixture';
import { fixtureLogin } from './fixture-login';

function fixtureDeck(mode: 'images' | 'metadata' | 'both', otherMember = false) {
  const id = '00000000-0000-4000-8000-000000000931';
  const deck = { id, user_id: otherMember ? process.env.E2E_SECOND_USER_ID! : process.env.E2E_USER_ID!, group_id: null,
    name: 'Owned arena enrichment fixture', commander: 'Talrand, Sky Summoner',
    commander_image: mode === 'metadata' ? '/images/icons/icon-192x192.png' : null,
    source_url: 'https://archidekt.com/decks/931', source_type: 'archidekt', bracket: mode === 'metadata' ? null : '3',
    color_identity: ['U'], is_favorite: false, created_at: '2026-11-19T10:00:00Z' };
  return deck;
}

async function openArenaEnrichment(page: Page, mode: 'images' | 'metadata' | 'both', otherMember = false, realWrite = false, beforeLogin?: () => Promise<void>) {
  const deck = fixtureDeck(mode, otherMember);
  const accounts = new Set<string>();
  await page.addInitScript(({ mode }) => {
    const request = window.requestIdleCallback.bind(window);
    const probe = window as typeof window & { __arenaImageIdleRan?: boolean; __arenaMetadataDelayRan?: boolean };
    const timer = window.setTimeout.bind(window);
    if (mode === 'both') window.setTimeout = ((callback: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms !== 4000 || typeof callback !== 'function') return timer(callback, ms, ...args);
      return timer(() => {
      if (ms === 4000) probe.__arenaMetadataDelayRan = true;
      callback(...args);
      }, ms);
    }) as typeof window.setTimeout;
    window.requestIdleCallback = (callback, options) => {
      if ((mode === 'images' && options?.timeout === 8000) || (mode === 'metadata' && options?.timeout === 6000)) return 940_000;
      return request(deadline => { if (options?.timeout === 6000) probe.__arenaImageIdleRan = true; callback(deadline); }, options);
    };
  }, { mode });
  await page.route('**/rest/v1/rpc/get_arena_member_decks', route => {
    const jwt = route.request().headers().authorization?.split(' ')[1];
    if (jwt) accounts.add(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub);
    return route.fulfill({ status: 200, json: [deck] });
  });
  // Synthetic deck IDs never reach private writes. Each test must explicitly
  // intercept and validate the one write path it is exercising.
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => {
    const query = new URL(route.request().url()).searchParams;
    if (realWrite && route.request().method() === 'PATCH' && query.get('id') === `eq.${deck.id}` && query.get('user_id') === `eq.${deck.user_id}`) return route.fallback();
    return route.fulfill({ status: 403, json: { code: '42501' } });
  });
  await beforeLogin?.();
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
  return { deck, accounts };
}

for (const mode of ['images', 'metadata'] as const) for (const phase of ['import', 'write'] as const) for (const exit of ['navigate', 'account'] as const) {
  test(`arena enrichment ${mode} cancels ${phase} on ${exit}`, async ({ page }) => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    let started = 0; let aborted = 0; let writes = 0; let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const held = new Set<import('@playwright/test').Request>();
    page.on('requestfailed', request => { if (held.has(request)) aborted += 1; });
    await page.route('**/api/deck-import', async route => {
      expect(route.request().postDataJSON()).toEqual({ url: fixtureDeck(mode).source_url });
      if (phase === 'import') { held.add(route.request()); started += 1; await pending; }
      await route.fulfill({ status: 200, json: { name: 'Imported snapshot', commander: 'Talrand, Sky Summoner',
        commanderImageUrl: '/images/icons/icon-192x192.png', bracket: '3' } }).catch(() => {});
    });
    const snapshot = fixtureDeck(mode);
    const fixture = await openArenaEnrichment(page, mode, false, false, async () => {
      await page.route(/\/rest\/v1\/decks(?:\?|$)/, async route => {
      expect(route.request().method()).toBe('PATCH');
      const query = new URL(route.request().url()).searchParams;
      expect(query.get('id')).toBe(`eq.${snapshot.id}`);
      expect(query.get('user_id')).toBe(`eq.${snapshot.user_id}`);
      expect(query.get('name')).toBe(`eq.${snapshot.name}`);
      expect(query.get('select')).toBe('id');
      writes += 1;
      if (phase === 'write') { held.add(route.request()); started += 1; await pending; }
      await route.fulfill({ status: 200, json: [{ id: snapshot.id }] }).catch(() => {});
      });
    });
    try {
      await expect.poll(() => started, { timeout: 10_000 }).toBe(1);
      if (exit === 'account') {
        await transitionFixtureSession(page, true);
        await expect.poll(() => fixture.accounts.has(process.env.E2E_SECOND_USER_ID!)).toBe(true);
      } else await page.getByRole('button', { name: 'Back to home', exact: true }).click();
      await expect.poll(() => aborted).toBe(1);
      release();
      if (phase === 'import') expect(writes).toBe(0);
    } finally { release(); }
  });
}

test('arena enrichment leaves other members decks read only', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  let imports = 0;
  await page.route('**/api/deck-import', route => { imports += 1; return route.fulfill({ status: 503 }); });
  await openArenaEnrichment(page, 'images', true);
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __arenaImageIdleRan?: boolean }).__arenaImageIdleRan))).toBe(true);
  expect(imports).toBe(0);
});

test('arena enrichment excludes duplicate metadata and image work for the same deck', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  let imports = 0; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/deck-import', async route => {
    imports += 1; await pending;
    await route.fulfill({ status: 503 }).catch(() => {});
  });
  try {
    await openArenaEnrichment(page, 'both');
    await expect.poll(() => imports).toBe(1);
    await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __arenaMetadataDelayRan?: boolean }).__arenaMetadataDelayRan)), { timeout: 8000 }).toBe(true);
    expect(imports).toBe(1);
    await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  } finally { release(); }
});

async function privateFixtureRequest(method: string, body?: unknown) {
  const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (new URL(backend).hostname !== process.env.STAGING_SUPABASE_DOMAIN) throw new Error('Dev fixture required');
  const filter = method === 'POST' ? '' : `?id=eq.${fixtureDeck('images').id}&user_id=eq.${process.env.E2E_USER_ID}`;
  return fetch(`${backend}/rest/v1/decks${filter}`, {
    method, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.E2E_ACCESS_TOKEN}`,
      'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
for (const changed of [false, true]) test(`arena enrichment real server CAS ${changed ? 'rejects a newer edit' : 'acknowledges the owned snapshot'}`, async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const deck = fixtureDeck('images');
  const seed = await privateFixtureRequest('POST', deck); expect(seed.ok).toBe(true);
  let started = 0; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const acknowledgements: Array<Array<{ id: string }>> = [];
  page.on('response', response => {
    if (response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/rest/v1/decks') {
      void response.json().then(rows => acknowledgements.push(rows)).catch(() => {});
    }
  });
  await page.route('**/api/deck-import', async route => {
    started += 1; await pending;
    await route.fulfill({ status: 200, json: { name: 'Imported snapshot', commander: deck.commander,
      commanderImageUrl: '/images/icons/icon-192x192.png', bracket: '3' } }).catch(() => {});
  });
  try {
    await openArenaEnrichment(page, 'images', false, true);
    await expect.poll(() => started).toBe(1);
    if (changed) { const edit = await privateFixtureRequest('PATCH', { name: 'Newer server edit' }); expect(edit.ok).toBe(true); }
    release();
    await expect.poll(() => acknowledgements.some(rows => Array.isArray(rows) && rows.length === (changed ? 0 : 1))).toBe(true);
    const read = await privateFixtureRequest('GET'); expect(read.ok).toBe(true);
    const rows = await read.json(); expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(changed ? 'Newer server edit' : 'Imported snapshot');
    expect(rows[0].commander_image).toBe(changed ? null : '/images/icons/icon-192x192.png');
    await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  } finally { release(); const cleanup = await privateFixtureRequest('DELETE'); expect(cleanup.ok).toBe(true); }
});

