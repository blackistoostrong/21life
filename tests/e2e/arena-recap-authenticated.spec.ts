import {createClient} from '@supabase/supabase-js';
import {test, expect} from '@playwright/test';
import {fixtureLogin} from './fixture-login';

declare global {interface Window {recapAuthenticatedQa: {copies: string[]; shares: {text?: string}[]};}}
async function interceptExports(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.recapAuthenticatedQa = {copies: [], shares: []};
    Object.defineProperty(navigator, 'share', {configurable: true, value: async (payload: {text?: string}) => {window.recapAuthenticatedQa.shares.push(payload);}});
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async (text: string) => {window.recapAuthenticatedQa.copies.push(text);}}});
  });
}
test('arena recap reads real Dev zero/manual/draw/guest/deleted-deck history and exports only the preview', async ({page}) => {
  test.setTimeout(90000); test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (new URL(backend).hostname !== process.env.STAGING_SUPABASE_DOMAIN) throw Error('Dev fixture required');
  const admin = createClient(backend, process.env.SUPABASE_SERVICE_ROLE_KEY!, {auth: {persistSession: false, autoRefreshToken: false}});
  const actor = createClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    accessToken: async () => process.env.E2E_ACCESS_TOKEN!, auth: {persistSession: false, autoRefreshToken: false},
  });
  const groupId = crypto.randomUUID(), deckId = crypto.randomUUID(), guestId = crypto.randomUUID(), guestDeckId = crypto.randomUUID();
  const userId = process.env.E2E_USER_ID!;
  const matchIds: string[] = [];
  try {
    const group = await admin.from('groups').insert({id: groupId, name: 'Recap QA', created_by: userId}).select('invite_code').single();
    expect(group.error).toBeNull();
    const member = await admin.from('group_members').upsert({group_id: groupId, user_id: userId}, {onConflict: 'group_id,user_id'}); expect(member.error).toBeNull();
    await interceptExports(page); await fixtureLogin(page); await page.goto(`/table/${groupId}`);
    const trigger = page.getByRole('button', {name: /^(Share recap|Condividi riepilogo)$/});
    await trigger.click(); const preview = page.getByRole('dialog').locator('pre');
    await expect(preview).toContainText(/Completed games: 0|Partite concluse: 0/);
    await expect(preview).toContainText(/Median duration: Data unavailable|Durata mediana: Dati non disponibili/);
    await page.getByRole('button', {name: /^(Close|Chiudi)$/}).click();

    // Exercise collection deletion, which is the existing user-facing flow.
    // Occasional decks have a separate immutable arena scope and no delete UI.
    const deck = await actor.from('decks').insert({id: deckId, user_id: userId, group_id: null, name: 'Recap Owner Deck',
      commander: "Atraxa, Praetors' Voice", source_type: 'manual'}); expect(deck.error).toBeNull();
    const guest = await actor.from('arena_guests').insert({id: guestId, group_id: groupId,
      display_name: 'Private Recap Guest', normalized_name: 'private recap guest'}); expect(guest.error).toBeNull();
    const guestDeck = await actor.from('arena_guest_decks').insert({id: guestDeckId, guest_id: guestId, group_id: groupId,
      name: 'Recap Guest Deck', commander: 'Krenko, Mob Boss'}); expect(guestDeck.error).toBeNull();
    for (const draw of [false, true]) {
      const id = crypto.randomUUID();
      matchIds.push(id);
      const header = await actor.from('matches').insert({id, group_id: groupId, created_by: userId, played_at: new Date().toISOString(),
        winner_id: draw ? null : userId, winner_guest_id: null, is_draw: draw, notes: 'PRIVATE_RECAP_NOTE',
        duration_seconds: draw ? 300 : null, tracking_version: draw ? 1 : null}); expect(header.error).toBeNull();
      const seats = await actor.from('match_participants').insert([
        {match_id: id, user_id: userId, guest_id: null, deck_id: deckId, guest_deck_id: null, is_winner: !draw,
          participant_name_snapshot: 'Private Recap Owner', commander_snapshot: "Atraxa, Praetors' Voice"},
        {match_id: id, user_id: null, guest_id: guestId, deck_id: null, guest_deck_id: guestDeckId, is_winner: false,
          participant_name_snapshot: 'Private Recap Guest', commander_snapshot: 'Krenko, Mob Boss'},
      ]); expect(seats.error).toBeNull();
    }
    const snapshots = await admin.from('match_participants').select('user_id,guest_id,participant_name_snapshot').in('match_id', matchIds);
    expect(snapshots.error).toBeNull();
    const ownerName = snapshots.data!.find(row => row.user_id === userId)?.participant_name_snapshot;
    const guestName = snapshots.data!.find(row => row.guest_id === guestId)?.participant_name_snapshot;
    expect(typeof ownerName).toBe('string'); expect(typeof guestName).toBe('string');
    const removed = await actor.from('decks').delete().eq('id', deckId).eq('user_id', userId); expect(removed.error).toBeNull();
    const historical = await admin.from('decks').select('source_type').eq('id', deckId).single();
    expect(historical.error).toBeNull(); expect(historical.data?.source_type).toBe('historical');
    await trigger.click(); await expect(preview).toContainText(/Completed games: 2|Partite concluse: 2/);
    await expect(preview).toContainText(/Distinct players: 2|Partecipanti distinti: 2/);
    await expect(preview).toContainText("Atraxa, Praetors' Voice"); await expect(preview).toContainText('Krenko, Mob Boss');
    await expect(preview).toContainText('5m 00s (1/2)');
    await expect(preview).not.toContainText(ownerName!); await expect(preview).not.toContainText(guestName!);
    const names = page.getByLabel(/^(Include player names|Includi nomi dei giocatori)$/);
    await names.check(); await expect(preview).toContainText(ownerName!); await expect(preview).toContainText(guestName!);
    await names.uncheck();
    const visible = (await preview.textContent())!;
    for (const secret of [userId, groupId, guestId, deckId, guestDeckId, group.data!.invite_code, 'PRIVATE_RECAP_NOTE', ownerName!, guestName!]) expect(visible).not.toContain(secret);
    await page.getByRole('button', {name: /^(Copy text|Copia testo)$/}).click();
    await expect(page.getByText(/^(Text copied\.|Testo copiato\.)$/)).toBeVisible();
    expect(await page.evaluate(() => window.recapAuthenticatedQa.copies)).toEqual([visible]);
    expect(await page.evaluate(() => window.recapAuthenticatedQa.shares)).toEqual([]);
    await page.getByLabel(/^(Period|Periodo)$/).selectOption('30'); await expect(preview).toContainText(/Completed games: 2|Partite concluse: 2/);
  } finally {
    const deckCleanup = await admin.from('decks').delete().eq('id', deckId).eq('user_id', userId); expect(deckCleanup.error).toBeNull();
    const cleanup = await admin.from('groups').delete().eq('id', groupId).eq('created_by', userId); expect(cleanup.error).toBeNull();
    const remaining = await admin.from('groups').select('id', {head: true, count: 'exact'}).eq('id', groupId);
    expect(remaining.error).toBeNull(); expect(remaining.count).toBe(0);
  }
});
test('arena recap cancels its real scoped request when the preview closes', async ({page}) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  await interceptExports(page); await fixtureLogin(page); await page.goto(`/table/${process.env.E2E_GROUP_ID!}`);
  let release!: () => void, reads = 0, aborted = 0;
  const held = new Promise<void>(resolve => {release = resolve;});
  page.on('requestfailed', request => {
    if (request.url().includes('/rpc/get_arena_history_page_v2') && request.postDataJSON()?.p_until) aborted++;
  });
  await page.route('**/rest/v1/rpc/get_arena_history_page_v2', async route => {
    const args = route.request().postDataJSON();
    if (!args.p_until || args.p_boundary_hour !== 0) return route.fallback();
    reads++; await held; await route.fulfill({status: 403, json: {code: '42501'}}).catch(() => {});
  });
  try {
    await page.getByRole('button', {name: /^(Share recap|Condividi riepilogo)$/}).click(); await expect.poll(() => reads).toBe(1);
    await page.getByRole('button', {name: /^(Close|Chiudi)$/}).click(); await expect.poll(() => aborted).toBe(1); release();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.recapAuthenticatedQa.shares)).toEqual([]);
    expect(await page.evaluate(() => window.recapAuthenticatedQa.copies)).toEqual([]);
  } finally {release();}
});
