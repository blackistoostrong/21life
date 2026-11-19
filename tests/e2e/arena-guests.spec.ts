import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { transitionFixtureSession } from './profile-auth-fixture';
import { createClient } from '@supabase/supabase-js';

const commander = { id: 'guest-commander-fixture', name: 'Talrand, Sky Summoner', imageUrl: null,
  typeLine: 'Legendary Creature — Merfolk Wizard', colorIdentity: ['U'], oracleText: '', keywords: [] };

async function openCreateGuest(page: Page) {
  await page.getByRole('button', { name: 'Add guest', exact: true }).click();
  try { await expect(page.getByRole('heading', { name: 'Add guest', exact: true })).toBeVisible(); }
  catch (error) {
    // Read only booleans/counts from the actual React owners, never identities,
    // session values or draft text. Diagnose missed opening without retrying it.
    const owners = await page.getByRole('button', { name: 'Add guest', exact: true }).evaluate(element => {
      type Epoch = { context: { key: string | null }; enabled: boolean };
      type Hook = { memoizedState: unknown; next: Hook | null };
      type Fiber = { memoizedState: Hook | null; return: Fiber | null; alternate?: Fiber | null };
      const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
      if (!key) return [];
      const output: Array<{ owners: Array<{ parts: number; enabled: boolean; jobs: number }>; drafts: Array<{ mode: string; owned: boolean }> }> = [];
      const inspect = (fiber: Fiber) => {
        const states: unknown[] = [];
        for (let hook = fiber.memoizedState; hook; hook = hook.next) states.push(hook.memoizedState);
        const leases = states.flatMap(state => {
          const value = state as { current?: { epoch?: Epoch; jobs?: Map<string, unknown> } } | null;
          return value?.current?.epoch && value.current.jobs instanceof Map ? [value.current] : [];
        });
        const drafts = states.flatMap(state => {
          const value = state as { opening?: number; mode?: string; epoch?: Epoch } | null;
          return value && typeof value.opening === 'number' && typeof value.mode === 'string'
            ? [{ mode: value.mode, owned: leases.some(lease => lease.epoch === value.epoch) }] : [];
        });
        if (leases.length || drafts.length) output.push({ owners: leases.map(lease => {
          let parts = 0;
          try { const parsed = JSON.parse(lease.epoch!.context.key ?? 'null'); if (Array.isArray(parsed)) parts = parsed.length; } catch { /* Non-JSON public context. */ }
          return { parts, enabled: lease.epoch!.enabled, jobs: lease.jobs!.size };
        }), drafts });
      };
      let fiber = (element as unknown as Record<string, Fiber>)[key];
      for (; fiber; fiber = fiber.return!) { inspect(fiber); if (fiber.alternate) inspect(fiber.alternate); }
      return output;
    });
    await test.info().attach('guest-opening-owner-counts', { body: JSON.stringify(owners), contentType: 'application/json' });
    throw error;
  }
}

async function openGuests(page: Page, withGuest = false) {
  const groupId = process.env.E2E_GROUP_ID!, guestId = randomUUID();
  const guest = { id: guestId, group_id: groupId, display_name: 'Guest command fixture', last_played_at: null, arena_guest_decks: [] };
  await page.route('**/rest/v1/arena_guests?*', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 200, json: withGuest ? [guest] : [] }) : route.fallback());
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${groupId}"]`).first().click();
  await page.getByRole('tab', { name: /Players/ }).click();
  await expect(page.getByRole('heading', { name: 'Playgroup guests and decks', exact: true })).toBeVisible();
  return guest;
}

async function prepareGuest(page: Page, name = 'Guest command fixture') {
  await page.route('**/api/scryfall-commanders?*', route => route.fulfill({ status: 200, json: { data: [commander] } }));
  await openCreateGuest(page);
  await page.getByPlaceholder('e.g. Marco', { exact: true }).fill(name);
  await page.getByPlaceholder('Card name...', { exact: true }).fill('talrand');
  await page.getByRole('button', { name: /Talrand, Sky Summoner.*Legendary Creature/ }).click();
  return page.getByRole('button', { name: 'Add guest', exact: true });
}

test('arena guest save synchronously blocks duplicate submission and preserves failed drafts', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const guest = await openGuests(page);
  const save = await prepareGuest(page);
  let writes = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/arena_guests?*', async route => {
    if (route.request().method() === 'GET') return route.fallback();
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 204 });
    writes += 1;
    if (writes === 1) {
      await pending;
      return route.fulfill({ status: 503, json: { message: 'Synthetic save failure' } });
    }
    return route.fulfill({ status: 201, json: guest });
  });
  await page.route('**/rest/v1/arena_guest_decks?*', route => route.fulfill({ status: 201, json: {
    id: randomUUID(), guest_id: guest.id, group_id: guest.group_id, name: commander.name, commander: commander.name,
    commander_image: null, color_identity: ['U'], bracket: null,
  } }));
  try {
    await save.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await expect.poll(() => writes).toBe(1);
    await expect(page.getByRole('button', { name: 'Saving...', exact: true })).toBeDisabled();
    release();
    await expect(page.getByText('Synthetic save failure', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('e.g. Marco', { exact: true })).toHaveValue(guest.display_name);
    await expect(save).toBeEnabled(); await save.click();
    await expect(page.getByRole('heading', { name: 'Add guest', exact: true })).toHaveCount(0);
    expect(writes).toBe(2);
  } finally { release(); }
});

test('arena guest delete blocks duplicate confirmation and requires an acknowledged row', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const guest = await openGuests(page, true);
  let prompts = 0, writes = 0, remaining = true;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  page.on('dialog', dialog => { prompts += 1; return dialog.accept(); });
  await page.route('**/rest/v1/arena_guests?*', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, json: remaining ? [guest] : [] });
    expect(route.request().method()).toBe('DELETE');
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('group_id')).toBe(`eq.${guest.group_id}`); expect(query.get('id')).toBe(`eq.${guest.id}`);
    writes += 1;
    if (writes === 1) { await pending; return route.fulfill({ status: 200, json: [] }); }
    remaining = false; return route.fulfill({ status: 200, json: [{ id: guest.id }] });
  });
  const remove = page.getByRole('button', { name: `Delete guest: ${guest.display_name}`, exact: true });
  try {
    await remove.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await expect.poll(() => writes).toBe(1); expect(prompts).toBe(1);
    release();
    await expect(page.getByText('Guest was not deleted', { exact: true })).toBeVisible();
    await expect(remove).toBeEnabled();
    await remove.click();
    await expect(remove).toHaveCount(0); expect(writes).toBe(2); expect(prompts).toBe(2);
  } finally { release(); }
});

test('arena guest draft does not return after account A to B to A', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  await openGuests(page);
  await prepareGuest(page);
  await transitionFixtureSession(page, true);
  await expect(page.getByRole('heading', { name: 'Add guest', exact: true })).toHaveCount(0);
  await transitionFixtureSession(page, false);
  await page.getByRole('tab', { name: /Players/ }).click();
  await expect(page.getByRole('button', { name: 'Add guest', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add guest', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add guest', exact: true }).click();
  await expect(page.getByPlaceholder('e.g. Marco', { exact: true })).toHaveValue('');
  await expect(page.getByPlaceholder('Card name...', { exact: true })).toHaveValue('');
});

test('arena guest repeated mounts reopen clean drafts without accumulating searches', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  await openGuests(page);
  let searches = 0;
  page.on('request', request => { if (request.url().includes('/api/scryfall-commanders?')) searches += 1; });
  for (let cycle = 0; cycle < 2; cycle += 1) {
    if (cycle > 0) {
      await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
      await page.getByRole('tab', { name: /Players/ }).click();
    }
    await prepareGuest(page);
    await expect.poll(() => searches).toBe(cycle + 1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await openCreateGuest(page);
    await expect(page.getByPlaceholder('e.g. Marco', { exact: true })).toHaveValue('');
    await expect(page.getByPlaceholder('Card name...', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Back to home', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
  expect(searches).toBe(2);
});

for (const partialFailure of [false, true]) {
  test(`arena guest real Dev ${partialFailure ? 'partial guest creation retries without duplication' : 'create, add deck and delete keeps the catalog consistent'}`, async ({ page }) => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    if (new URL(backend).hostname !== process.env.STAGING_SUPABASE_DOMAIN) throw new Error('Dev fixture required');
    const client = createClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { accessToken: async () => process.env.E2E_ACCESS_TOKEN! });
    const groupId = process.env.E2E_GROUP_ID!, name = `guest-${randomUUID()}`;
    const read = () => client.from('arena_guests').select('id,display_name,arena_guest_decks(id,name)')
      .eq('group_id', groupId).eq('normalized_name', name);
    let deckWrites = 0, guestWrites = 0;
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/rest/v1/arena_guests') guestWrites += 1; });
    if (partialFailure) {
      // Keep the catalog stale after the partial commit; recovery must query the
      // existing unique group/name row, not rely on a lucky Realtime refresh.
      await page.route('**/rest/v1/arena_guests?*', route => route.request().method() === 'GET'
        && new URL(route.request().url()).searchParams.get('select')?.includes('arena_guest_decks')
        ? route.fulfill({ status: 200, json: [] }) : route.fallback());
      await page.route('**/rest/v1/arena_guest_decks?*', route => route.request().method() === 'POST' && ++deckWrites === 1
        ? route.fulfill({ status: 503, json: { message: 'Synthetic partial deck failure' } }) : route.fallback());
    }
    try {
      await fixtureLogin(page);
      await page.locator(`a[href="/table/${groupId}"]`).first().click();
      await page.getByRole('tab', { name: /Players/ }).click();
      const save = await prepareGuest(page, name);
      await save.click();
      if (partialFailure) {
        await expect(page.getByText('Synthetic partial deck failure', { exact: true })).toBeVisible();
        await expect(page.getByPlaceholder('e.g. Marco', { exact: true })).toHaveValue(name);
        const partial = await read(); expect(partial.error).toBeNull();
        expect(partial.data).toHaveLength(1); expect(partial.data![0].arena_guest_decks).toHaveLength(0);
        await save.click();
      }
      await expect(page.getByRole('heading', { name: 'Add guest', exact: true })).toHaveCount(0);
      const created = await read(); expect(created.error).toBeNull(); expect(created.data).toHaveLength(1);
      expect(created.data![0].arena_guest_decks).toHaveLength(1);
      expect(guestWrites).toBe(partialFailure ? 2 : 1);
      if (!partialFailure) {
        const row = page.getByRole('region', { name, exact: true });
        await expect(row).toBeVisible();
        await row.getByRole('button', { name: `Add deck: ${name}`, exact: true }).click();
        await page.getByPlaceholder('Card name...', { exact: true }).fill('talrand');
        await page.getByRole('button', { name: /Talrand, Sky Summoner.*Legendary Creature/ }).click();
        await page.getByPlaceholder('e.g. Gruul Stompy', { exact: true }).fill('Second guest deck');
        await page.getByRole('button', { name: 'Save deck', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Add guest deck', exact: true })).toHaveCount(0);
        const updated = await read(); expect(updated.error).toBeNull(); expect(updated.data![0].arena_guest_decks).toHaveLength(2);
        page.on('dialog', dialog => dialog.accept());
        await row.getByRole('button', { name: `Delete guest: ${name}`, exact: true }).click();
        await expect(row).toHaveCount(0);
        const removed = await read(); expect(removed.error).toBeNull(); expect(removed.data).toEqual([]);
        const decks = await client.from('arena_guest_decks').select('id').eq('group_id', groupId).eq('guest_id', created.data![0].id);
        expect(decks.error).toBeNull(); expect(decks.data).toEqual([]);
      }
    } finally {
      const cleanup = await client.from('arena_guests').delete().eq('group_id', groupId).eq('normalized_name', name);
      expect(cleanup.error).toBeNull();
      const verified = await read(); expect(verified.error).toBeNull(); expect(verified.data).toEqual([]);
    }
  });
}

test('arena guest search replaces a pending query without accepting its old result', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  await openGuests(page);
  let started = 0, aborted = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  page.on('requestfailed', request => { if (new URL(request.url()).searchParams.get('q') === 'first') aborted += 1; });
  await page.route('**/api/scryfall-commanders?*', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'first') {
      started += 1; await pending;
      return route.fulfill({ status: 200, json: { data: [commander] } }).catch(() => {});
    }
    return route.fulfill({ status: 200, json: { data: [{ ...commander, id: 'fresh', name: 'Fresh commander fixture' }] } });
  });
  try {
    await openCreateGuest(page);
    await page.getByPlaceholder('Card name...', { exact: true }).fill('first');
    await expect.poll(() => started).toBe(1);
    await page.getByPlaceholder('Card name...', { exact: true }).fill('second');
    await expect.poll(() => aborted).toBe(1);
    await expect(page.getByRole('button', { name: /Fresh commander fixture/ })).toBeVisible();
    release();
    await expect(page.getByRole('button', { name: /Talrand, Sky Summoner/ })).toHaveCount(0);
  } finally { release(); }
});

for (const stage of ['guest', 'deck', 'delete'] as const) {
  for (const departure of ['navigate', 'account'] as const) {
    test(`arena guest command ${stage} cancels on ${departure}`, async ({ page }) => {
      test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
      const guest = await openGuests(page, stage === 'delete');
      let started = 0, aborted = 0;
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const requests = new Set<import('@playwright/test').Request>();
      page.on('requestfailed', request => { if (requests.has(request)) aborted += 1; });
      await page.route('**/rest/v1/arena_guests?*', async route => {
        const method = route.request().method();
        if (method === 'GET') return route.fallback();
        if (stage === 'deck' && method === 'POST') return route.fulfill({ status: 201, json: guest });
        if (method === 'PATCH') return route.fulfill({ status: 204 });
        requests.add(route.request()); started += 1; await pending;
        await route.fulfill({ status: 503, json: { message: 'Synthetic guest command failure' } }).catch(() => { /* Disposed command. */ });
      });
      if (stage === 'deck') await page.route('**/rest/v1/arena_guest_decks?*', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        requests.add(route.request()); started += 1; await pending;
        await route.fulfill({ status: 503, json: { message: 'Synthetic guest deck failure' } }).catch(() => { /* Disposed command. */ });
      });
      try {
        if (stage === 'delete') {
          page.on('dialog', dialog => dialog.accept());
          await page.getByRole('button', { name: `Delete guest: ${guest.display_name}`, exact: true }).click();
        } else await (await prepareGuest(page)).click();
        await expect.poll(() => started).toBe(1);
        if (departure === 'navigate') {
          await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/);
        } else {
          await transitionFixtureSession(page, true);
          await expect(page.getByRole('button', { name: 'Back to home', exact: true })).toBeVisible();
        }
        await expect.poll(() => aborted).toBe(1);
        release();
        await expect(page.getByText('Synthetic guest command failure', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Synthetic guest deck failure', { exact: true })).toHaveCount(0);
        if (departure === 'account') await expect(page.getByRole('heading', { name: 'Add guest', exact: true })).toHaveCount(0);
      } finally { release(); }
    });
  }
}

for (const departure of ['close', 'navigate'] as const) {
  test(`arena guest search cancels on ${departure}`, async ({ page }) => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    await openGuests(page);
    let started = 0, aborted = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    page.on('requestfailed', request => { if (request.url().includes('/api/scryfall-commanders?')) aborted += 1; });
    await page.route('**/api/scryfall-commanders?*', async route => {
      started += 1; await pending;
      await route.fulfill({ status: 200, json: { data: [commander] } }).catch(() => { /* Disposed search. */ });
    });
    try {
      await page.getByRole('button', { name: 'Add guest', exact: true }).click();
      await page.getByPlaceholder('Card name...', { exact: true }).fill('talrand');
      await expect.poll(() => started).toBe(1);
      if (departure === 'close') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      else { await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/); }
      await expect.poll(() => aborted).toBe(1);
    } finally { release(); }
  });
}
