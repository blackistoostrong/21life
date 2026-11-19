import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { fixtureLogin } from './fixture-login';

test('arena realtime updates guests and member decks after a real mixed Dev burst', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const groupId = process.env.E2E_GROUP_ID!, userId = process.env.E2E_USER_ID!;
  const guestId = randomUUID(), deckId = randomUUID();
  const guestName = `Realtime guest ${guestId.slice(0, 8)}`, deckName = `Realtime deck ${deckId.slice(0, 8)}`;
  const topic = `realtime:arena:${groupId}:catalog`;
  let subscribed = false;
  page.on('websocket', socket => {
    const joins = new Set<string>();
    const message = (payload: string | Buffer) => {
      try {
        const row = JSON.parse(payload.toString());
        return Array.isArray(row) ? { ref: row[1], topic: row[2], event: row[3], payload: row[4] } : row;
      } catch { return null; }
    };
    socket.on('framesent', frame => {
      const row = message(frame.payload);
      if (row?.topic === topic && row.event === 'phx_join') joins.add(String(row.ref));
    });
    socket.on('framereceived', frame => {
      const row = message(frame.payload);
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
  await expect.poll(() => subscribed, { timeout: 15_000 }).toBe(true);
  try {
    const seeded = await Promise.all([
      request('arena_guests', 'POST', guestId, { id: guestId, group_id: groupId, display_name: guestName }),
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
