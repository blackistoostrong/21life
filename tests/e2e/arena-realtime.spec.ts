import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { fixtureLogin } from './fixture-login';

test('arena realtime updates guests and member decks after a real mixed Dev burst', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const groupId = process.env.E2E_GROUP_ID!, userId = process.env.E2E_USER_ID!;
  const guestId = randomUUID(), deckId = randomUUID();
  const guestName = `Realtime guest ${guestId.slice(0, 8)}`, deckName = `Realtime deck ${deckId.slice(0, 8)}`;
  const topic = `realtime:arena:${groupId}:catalog`;
  let subscribed = false;
  const diagnostic = { sockets: 0, errors: 0, undecoded: 0, pageErrors: 0, cspErrors: 0, frames: [] as Array<{ direction: string; event: string; target: boolean; status: string; reason: string }> };
  page.on('pageerror', () => { diagnostic.pageErrors += 1; });
  page.on('console', event => { if (event.text().includes('Content Security Policy')) diagnostic.cspErrors += 1; });
  page.on('websocket', socket => {
    diagnostic.sockets += 1;
    socket.on('socketerror', () => { diagnostic.errors += 1; });
    const joins = new Set<string>();
    const message = (payload: string | Buffer) => {
      try {
        const row = JSON.parse(payload.toString());
        return Array.isArray(row) ? { ref: row[1], topic: row[2], event: row[3], payload: row[4] } : row;
      } catch { diagnostic.undecoded += 1; return null; }
    };
    const record = (direction: string, row: ReturnType<typeof message>) => {
      if (!row) return;
      const reason = String(row.payload?.response?.reason ?? '').toLowerCase();
      diagnostic.frames.push({ direction, event: String(row.event).slice(0, 40), target: row.topic === topic,
        status: row.payload?.status === 'ok' ? 'ok' : row.payload?.status === 'error' ? 'error' : '',
        reason: reason.includes('permission') || reason.includes('authoriz') ? 'permission' : reason.includes('token') ? 'token' : reason ? 'other' : '' });
    };
    socket.on('framesent', frame => {
      const row = message(frame.payload);
      record('sent', row);
      if (row?.topic === topic && row.event === 'phx_join') joins.add(String(row.ref));
    });
    socket.on('framereceived', frame => {
      const row = message(frame.payload);
      record('received', row);
      if (row?.topic === topic && row.event === 'phx_reply' && row.payload?.status === 'ok' && joins.has(String(row.ref))) subscribed = true;
    });
  });
  const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (new URL(backend).hostname !== process.env.STAGING_SUPABASE_DOMAIN) throw new Error('Dev fixtures required');
  const request = (table: string, method: string, id: string, body?: unknown) => fetch(`${backend}/rest/v1/${table}${method === 'POST' ? '' : `?id=eq.${id}`}`, {
    method, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.E2E_ACCESS_TOKEN}`,
      'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${groupId}"]`).first().click();
  try { await expect.poll(() => subscribed, { timeout: 15_000 }).toBe(true); }
  finally {
    const path = `artifacts/dev26/arena-realtime-status-${test.info().project.name}.json`;
    writeFileSync(path, JSON.stringify(diagnostic));
    await test.info().attach('sanitized-realtime-status', { path, contentType: 'application/json' });
  }
  try {
    const seeded = await Promise.all([
      request('arena_guests', 'POST', guestId, { id: guestId, group_id: groupId, display_name: guestName, normalized_name: guestName.toLowerCase() }),
      request('decks', 'POST', deckId, { id: deckId, user_id: userId, name: deckName, commander: 'Talrand, Sky Summoner',
        commander_image: '/images/icons/icon-192x192.png', color_identity: ['U'] }),
    ]);
    seeded.forEach(response => expect(response.ok).toBe(true));
    await page.getByRole('tab', { name: /Players/ }).click();
    await expect(page.getByRole('region', { name: guestName, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Record Battle', exact: true }).click();
    await page.getByText('(2 decks)', { exact: true }).click();
    await expect(page.getByText(deckName, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  } finally {
    const cleaned = await Promise.all([request('arena_guests', 'DELETE', guestId), request('decks', 'DELETE', deckId)]);
    cleaned.forEach(response => expect(response.ok).toBe(true));
  }
});

test('arena realtime permits a member and rejects an authenticated fixture after leaving its group', async () => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (new URL(backend).hostname !== process.env.STAGING_SUPABASE_DOMAIN) throw new Error('Dev fixture required');
  const client = createClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    accessToken: async () => process.env.E2E_ACCESS_TOKEN!, realtime: { timeout: 5000 },
  });
  const outsider = createClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }, realtime: { timeout: 5000 },
  });
  let outsiderToken: string | null = null;
  const receiver = createClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    accessToken: async () => outsiderToken, realtime: { timeout: 5000 },
  });
  // Separate service client is used only to restore disposable fixture membership.
  const cleanup = createClient(backend, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  let joined = false, denied = false, unexpected = false;
  const statuses: Array<{ status: string; reason: string }> = [];
  try {
    await client.realtime.setAuth();
    client.channel(`arena:${process.env.E2E_GROUP_ID!}:catalog`, { config: { private: true } })
      .on('broadcast', { event: 'catalog_changed' }, () => {})
      .subscribe(status => { if (status === 'SUBSCRIBED') joined = true; });
    await expect.poll(() => joined, { timeout: 15_000 }).toBe(true);
    const signedIn = await outsider.auth.signInWithPassword({ email: process.env.E2E_SECOND_EMAIL!, password: process.env.E2E_PASSWORD! });
    expect(signedIn.error).toBeNull(); expect(signedIn.data.user?.id).toBe(process.env.E2E_SECOND_USER_ID);
    outsiderToken = signedIn.data.session!.access_token;
    const left = await outsider.from('group_members').delete().eq('group_id', process.env.E2E_GROUP_ID!)
      .eq('user_id', process.env.E2E_SECOND_USER_ID!).select('user_id');
    expect(left.error).toBeNull(); expect(left.data).toHaveLength(1);
    const membership = await outsider.rpc('is_group_member', { p_group_id: process.env.E2E_GROUP_ID!, p_user_id: process.env.E2E_SECOND_USER_ID! });
    expect(membership.error).toBeNull(); expect(membership.data).toBe(false);
    await receiver.realtime.setAuth();
    receiver.channel(`arena:${process.env.E2E_GROUP_ID!}:catalog`, { config: { private: true } })
      .on('broadcast', { event: 'catalog_changed' }, () => {})
      .subscribe((status, error) => {
        statuses.push({ status: String(status), reason: /permission|authoriz/i.test(error?.message ?? '') ? 'permission' : error ? 'other' : '' });
        if (status === 'SUBSCRIBED') unexpected = true;
        if (status === 'CHANNEL_ERROR') {
          denied = /permission|authoriz/i.test(error?.message ?? '');
          unexpected = unexpected || !denied;
        }
        // This self-hosted Realtime reports unreadable topics as timeout. Require
        // a live socket and verified nonmembership, not an arbitrary network error.
        if (status === 'TIMED_OUT') { denied = receiver.realtime.isConnected(); unexpected = unexpected || !denied; }
      });
    await expect.poll(() => denied || unexpected, { timeout: 15_000 }).toBe(true);
    expect(denied).toBe(true); expect(unexpected).toBe(false);
  } finally {
    writeFileSync('artifacts/dev26/arena-realtime-denial-status.json', JSON.stringify(statuses));
    const restored = await cleanup.from('group_members').upsert({ group_id: process.env.E2E_GROUP_ID!, user_id: process.env.E2E_SECOND_USER_ID! }, { onConflict: 'group_id,user_id' });
    try { expect(restored.error).toBeNull(); }
    finally {
      await Promise.all([client.removeAllChannels(), outsider.removeAllChannels(), receiver.removeAllChannels()]);
      await Promise.all([client.realtime.disconnect(), outsider.realtime.disconnect(), receiver.realtime.disconnect()]);
    }
  }
});
