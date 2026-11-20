import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
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

async function seedMatch() {
  const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (new URL(backend).hostname !== process.env.STAGING_SUPABASE_DOMAIN) throw new Error('Dev fixture required');
  const client = createClient(backend, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = randomUUID(), groupId = process.env.E2E_GROUP_ID!, notes = `match-command-${id}`;
  const cleanup = async () => {
    const removed = await client.from('matches').delete().eq('id', id).eq('group_id', groupId);
    expect(removed.error).toBeNull();
    const remaining = await client.from('matches').select('id').eq('id', id);
    expect(remaining.error).toBeNull(); expect(remaining.data).toEqual([]);
  };
  try {
    const match = await client.from('matches').insert({ id, group_id: groupId, created_by: process.env.E2E_USER_ID!,
      is_draw: true, played_at: new Date().toISOString(), notes });
    expect(match.error).toBeNull();
    const participants = await client.from('match_participants').insert([process.env.E2E_USER_ID!, process.env.E2E_SECOND_USER_ID!]
      .map(user_id => ({ match_id: id, user_id, is_winner: false })));
    expect(participants.error).toBeNull();
    return { id, groupId, notes, client, cleanup };
  } catch (error) { await cleanup(); throw error; }
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
  await page.route('**/rest/v1/matches?*', route => route.request().method() === 'DELETE'
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
  } finally { await fixture.cleanup(); }
});
