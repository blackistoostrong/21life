import { randomUUID } from 'node:crypto';
import { seedArenaMatch as seedMatch } from './fixtures/arena-match';
import { expect, test, type Page } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { transitionFixtureSession } from './profile-auth-fixture';

async function openCreate(page: Page) {
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
  await page.getByRole('button', { name: 'Record Battle', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('(1 deck)', { exact: true })).toHaveCount(2);
  await dialog.getByText('(1 deck)', { exact: true }).nth(0).click();
  await dialog.getByText('(1 deck)', { exact: true }).nth(1).click();
  await dialog.getByRole('checkbox', { name: 'Draw', exact: true }).check();
  return dialog.getByRole('button', { name: 'Record Battle', exact: true });
}


async function openSeeded(page: Page, notes: string, action: 'edit' | 'delete') {
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${process.env.E2E_GROUP_ID!}"]`).first().click();
  const note = page.getByText(notes, { exact: true });
  await expect(note).toBeVisible();
  // Existing icon-only actions have no accessible names. Anchor to the actual
  // synthetic battle, not a page-wide icon that could target group management.
  const actions = note.locator('xpath=ancestor::div[.//button][1]').getByRole('button');
  await expect(actions).toHaveCount(3);
  return actions.nth(action === 'edit' ? 1 : 2);
}

for (const operation of ['create', 'edit', 'delete'] as const) {
  for (const departure of ['navigate', 'account'] as const) {
    test(`arena match command ${operation} cancels on ${departure}`, async ({ page }) => {
      test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
      const fixture = operation === 'create' ? null : await seedMatch();
      let started = 0, aborted = 0;
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const requests = new Set<import('@playwright/test').Request>();
      page.on('requestfailed', request => { if (requests.has(request)) aborted += 1; });
      await page.route('**/rest/v1/matches?*', async route => {
        const method = route.request().method();
        if (method !== (operation === 'create' ? 'POST' : operation === 'edit' ? 'PATCH' : 'DELETE')) return route.fallback();
        requests.add(route.request()); started += 1; await pending;
        await route.fulfill({ status: 503, json: { message: 'Synthetic match command failure' } }).catch(() => { /* Disposed command. */ });
      });
      // The atomic successor uses one RPC for create/edit; keep the same owned
      // cancellation assertion at this transport boundary.
      if (operation !== 'delete') await page.route('**/rest/v1/rpc/save_arena_match_v1', async route => {
        requests.add(route.request()); started += 1; await pending;
        await route.fulfill({ status: 503, json: { message: 'Synthetic match command failure' } }).catch(() => { /* Disposed command. */ });
      });
      if (operation === 'delete') await page.route('**/rest/v1/match_participants?*', route =>
        route.request().method() === 'DELETE' ? route.fulfill({ status: 204 }) : route.fallback());
      try {
        if (operation === 'create') await (await openCreate(page)).click();
        else {
          const action = await openSeeded(page, fixture!.notes, operation);
          if (operation === 'edit') {
            await action.click();
            await page.getByRole('dialog').locator('textarea').fill('Scoped edit draft');
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
          } else {
            page.on('dialog', dialog => dialog.accept());
            await action.click();
          }
        }
        await expect.poll(() => started).toBe(1);
        if (departure === 'navigate') { await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/); }
        else await transitionFixtureSession(page, true);
        await expect.poll(() => aborted).toBe(1);
        release();
        await expect(page.getByText('Synthetic match command failure', { exact: true })).toHaveCount(0);
        if (departure === 'account') await expect(page.getByRole('dialog')).toHaveCount(0);
      } finally { release(); await fixture?.cleanup(); }
    });
  }
}

test('arena match delete failure preserves both the parent and its participants on real Dev', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedMatch();
  let fail = true;
  await page.route('**/rest/v1/matches?*', route => fail && route.request().method() === 'DELETE'
    ? route.fulfill({ status: 503, json: { message: 'Synthetic parent delete failure' } }) : route.fallback());
  try {
    const action = await openSeeded(page, fixture.notes, 'delete');
    page.on('dialog', dialog => dialog.accept());
    await action.click();
    await expect(page.getByText('Error', { exact: true })).toBeVisible();
    const [parent, participants] = await Promise.all([
      fixture.client.from('matches').select('id').eq('id', fixture.id),
      fixture.client.from('match_participants').select('id').eq('match_id', fixture.id),
    ]);
    expect(parent.error).toBeNull(); expect(parent.data).toHaveLength(1);
    expect(participants.error).toBeNull(); expect(participants.data).toHaveLength(2);
    fail = false;
    await expect(action).toBeEnabled(); await action.click();
    await expect(page.getByText('Battle deleted', { exact: true })).toBeVisible();
    const remaining = await fixture.client.from('match_participants').select('id').eq('match_id', fixture.id);
    expect(remaining.error).toBeNull(); expect(remaining.data).toEqual([]);
  } finally { await fixture.cleanup(); }
});

test('arena match delete synchronously blocks duplicate confirmation and commands on real Dev', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedMatch();
  let writes = 0, prompts = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/matches?*', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('id')).toBe(`eq.${fixture.id}`); expect(query.get('group_id')).toBe(`eq.${fixture.groupId}`);
    writes += 1; await pending;
    const response = await route.fetch(); await route.fulfill({ response });
  });
  try {
    const action = await openSeeded(page, fixture.notes, 'delete');
    page.on('dialog', dialog => { prompts += 1; return dialog.accept(); });
    await action.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await expect.poll(() => writes).toBe(1); expect(prompts).toBe(1);
    release();
    await expect(page.getByText('Battle deleted', { exact: true })).toBeVisible();
    const remaining = await fixture.client.from('match_participants').select('id').eq('match_id', fixture.id);
    expect(remaining.error).toBeNull(); expect(remaining.data).toEqual([]);
  } finally { release(); await fixture.cleanup(); }
});

for (const language of ['en', 'it'] as const) {
  test(`arena match delete requires an acknowledged row with ${language} feedback`, async ({ page }) => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    const fixture = await seedMatch();
    await page.route('**/rest/v1/matches?*', route => route.request().method() === 'DELETE'
      ? route.fulfill({ status: 200, json: [] }) : route.fallback());
    try {
      const action = await openSeeded(page, fixture.notes, 'delete');
      await page.getByRole('button', { name: language.toUpperCase(), exact: true }).click();
      page.on('dialog', dialog => dialog.accept()); await action.click();
      await expect(page.getByText(language === 'it'
        ? 'Partita non eliminata: verifica di essere proprietario dell’arena o creatore della partita.'
        : 'Match not deleted: verify that you own the arena or created the match.', { exact: true })).toBeVisible();
      const participants = await fixture.client.from('match_participants').select('id').eq('match_id', fixture.id);
      expect(participants.error).toBeNull(); expect(participants.data).toHaveLength(2);
    } finally { await fixture.cleanup(); }
  });
}

test('arena match edit failure rolls back its header and participants on real Dev', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedMatch();
  await page.route('**/rest/v1/match_participants?*', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 503, json: { message: 'Synthetic participant write failure' } }) : route.fallback());
  await page.route('**/rest/v1/rpc/save_arena_match_v1', async route => {
    const input = route.request().postDataJSON();
    // Simulate a selected deck that disappeared before commit. The real server
    // must roll back the earlier header write when one participant is invalid.
    const response = await route.fetch({ postData: JSON.stringify({ ...input,
      p_participants: input.p_participants.map((participant: Record<string, unknown>, index: number) => index === 0
        ? { ...participant, deck_id: randomUUID() } : participant) }) });
    await route.fulfill({ response });
  });
  try {
    await (await openSeeded(page, fixture.notes, 'edit')).click();
    await page.getByRole('dialog').locator('textarea').fill('Header change must roll back');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByText('Error', { exact: true })).toBeVisible();
    const header = await fixture.client.from('matches').select('notes').eq('id', fixture.id).single();
    expect(header.error).toBeNull(); expect(header.data?.notes).toBe(fixture.notes);
    const participants = await fixture.client.from('match_participants').select('id,deck_id').eq('match_id', fixture.id);
    expect(participants.error).toBeNull(); expect(participants.data).toHaveLength(2);
    expect(participants.data?.every(row => row.deck_id === null)).toBe(true);
  } finally { await fixture.cleanup(); }
});

test('arena match create reuses its request UUID after a committed response is lost on real Dev', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedMatch();
  const requestIds: string[] = [];
  let forwarded = 0, replied = 0;
  await page.route('**/rest/v1/rpc/save_arena_match_v1', async route => {
    requestIds.push(route.request().postDataJSON().p_match_id);
    const response = await route.fetch();
    forwarded++;
    expect(response.ok()).toBe(true);
    if (requestIds.length === 1) await route.fulfill({ status: 503, json: { message: 'Synthetic lost acknowledgement after commit' } });
    else await route.fulfill({ response });
    replied++;
  });
  try {
    const saveInitial = await openCreate(page);
    const failedReply = page.waitForResponse(response => response.url().endsWith('/rest/v1/rpc/save_arena_match_v1') && response.status() === 503);
    await Promise.all([failedReply, saveInitial.click()]);
    // The existing one-toast queue can replace command feedback with the real
    // match-completed notification. Assert durable UI/DB state instead.
    const save = page.getByRole('dialog').getByRole('button', { name: 'Record Battle', exact: true });
    await expect(save).toBeEnabled();
    expect(requestIds).toHaveLength(1);
    const committed = await fixture.client.from('matches').select('id').eq('id', requestIds[0]).eq('group_id', fixture.groupId);
    expect(committed.error).toBeNull(); expect(committed.data).toHaveLength(1);
    const successfulReply = page.waitForResponse(response => response.url().endsWith('/rest/v1/rpc/save_arena_match_v1') && response.status() === 200);
    await Promise.all([successfulReply, save.click()]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requestIds).toHaveLength(2); expect(requestIds[1]).toBe(requestIds[0]);
    const participants = await fixture.client.from('match_participants').select('id').eq('match_id', requestIds[0]);
    expect(participants.error).toBeNull(); expect(participants.data).toHaveLength(2);
    const parent = await fixture.client.from('matches').select('id').eq('id', requestIds[0]).eq('group_id', fixture.groupId);
    expect(parent.error).toBeNull(); expect(parent.data).toHaveLength(1);
  } catch (error) {
    console.log('Lost match acknowledgement diagnostic', JSON.stringify({ requests: requestIds.length, forwarded, replied,
      dialogVisible: await page.getByRole('dialog').isVisible().catch(() => false),
      errorCount: await page.getByText('Error', { exact: true }).count().catch(() => -1) }));
    throw error;
  } finally {
    if (requestIds.length) {
      const removed = await fixture.client.from('matches').delete().in('id', Array.from(new Set(requestIds))).eq('group_id', fixture.groupId);
      expect(removed.error).toBeNull();
      const remaining = await fixture.client.from('matches').select('id').in('id', Array.from(new Set(requestIds)));
      expect(remaining.error).toBeNull(); expect(remaining.data).toEqual([]);
    }
    await fixture.cleanup();
  }
});

test('arena match edit saves real changes while preserving unknown dates and participant identities', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = await seedMatch();
  let originalSeasonEnabled: boolean | undefined;
  try {
    const settings = await fixture.client.from('groups').select('seasons_enabled').eq('id', fixture.groupId).single();
    expect(settings.error).toBeNull(); originalSeasonEnabled = settings.data!.seasons_enabled;
    // Undated historical matches are outside a current-season report. Use the
    // existing all-time mode in this disposable group, then restore its setting.
    const allTime = await fixture.client.from('groups').update({ seasons_enabled: false }).eq('id', fixture.groupId);
    expect(allTime.error).toBeNull();
    const unknownDate = await fixture.client.from('matches').update({ played_at: null }).eq('id', fixture.id);
    expect(unknownDate.error).toBeNull();
    const before = await fixture.client.from('match_participants').select('id,user_id,guest_id,deck_id,guest_deck_id,is_winner').eq('match_id', fixture.id).order('id');
    expect(before.error).toBeNull();
    await (await openSeeded(page, fixture.notes, 'edit')).click();
    await expect(page.getByRole('dialog').locator('input[type="date"]')).toHaveValue('');
    const notes = `edited-${fixture.id}`;
    await page.getByRole('dialog').locator('textarea').fill(notes);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByText('Battle updated!', { exact: true })).toBeVisible();
    const header = await fixture.client.from('matches').select('notes,played_at,is_draw').eq('id', fixture.id).single();
    expect(header.error).toBeNull(); expect(header.data).toEqual({ notes, played_at: null, is_draw: true });
    const after = await fixture.client.from('match_participants').select('id,user_id,guest_id,deck_id,guest_deck_id,is_winner').eq('match_id', fixture.id).order('id');
    expect(after.error).toBeNull(); expect(after.data).toEqual(before.data);
  } finally {
    try {
      if (originalSeasonEnabled !== undefined) {
        const restored = await fixture.client.from('groups').update({ seasons_enabled: originalSeasonEnabled }).eq('id', fixture.groupId);
        expect(restored.error).toBeNull();
      }
    } finally { await fixture.cleanup(); }
  }
});

for (const operation of ['create', 'edit'] as const) test(`arena match ${operation} cancels on form close and reopens without stale busy state`, async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const fixture = operation === 'edit' ? await seedMatch() : null;
  let started = 0, aborted = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests = new Set<import('@playwright/test').Request>();
  page.on('requestfailed', request => { if (requests.has(request)) aborted++; });
  await page.route('**/rest/v1/rpc/save_arena_match_v1', async route => {
    requests.add(route.request()); started++;
    await pending;
    await route.fulfill({ status: 503, json: { message: 'Synthetic closed form reply' } }).catch(() => {});
  });
  try {
    const action = operation === 'edit' ? await openSeeded(page, fixture!.notes, 'edit') : null;
    if (action) { await action.click(); await page.getByRole('button', { name: 'Save Changes', exact: true }).click(); }
    else await (await openCreate(page)).click();
    await expect.poll(() => started).toBe(1);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(() => aborted).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (action) await action.click();
    else await page.getByRole('button', { name: 'Record Battle', exact: true }).click();
    const save = page.getByRole('dialog').getByRole('button', { name: operation === 'edit' ? 'Save Changes' : 'Record Battle', exact: true });
    await expect(save).toBeEnabled();
    release();
    await expect(page.getByText('Error', { exact: true })).toHaveCount(0);
    expect(started).toBe(1);
  } finally { release(); await fixture?.cleanup(); }
});
