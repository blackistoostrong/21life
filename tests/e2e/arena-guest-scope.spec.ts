import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

for (const operation of ['insert', 'replace-guest', 'move-group', 'cascade'] as const) {
  test(`arena guest scope ${operation} preserves the guest group relationship on real Dev`, async () => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    if (new URL(backend).hostname !== process.env.STAGING_SUPABASE_DOMAIN) throw new Error('Dev fixture required');
    const fixture = createClient(backend, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const actor = createClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { accessToken: async () => process.env.E2E_ACCESS_TOKEN! });
    const ownGroup = process.env.E2E_GROUP_ID!, foreignGroup = randomUUID(), ownGuest = randomUUID(), foreignGuest = randomUUID(), deckId = randomUUID();
    try {
      const group = await fixture.from('groups').insert({ id: foreignGroup, name: 'Guest scope fixture', created_by: process.env.E2E_SECOND_USER_ID! });
      expect(group.error).toBeNull();
      const guests = await fixture.from('arena_guests').insert([
        { id: ownGuest, group_id: ownGroup, display_name: 'Own scope fixture', normalized_name: ownGuest },
        { id: foreignGuest, group_id: foreignGroup, display_name: 'Foreign scope fixture', normalized_name: foreignGuest },
      ]);
      expect(guests.error).toBeNull();
      if (operation === 'move-group') {
        // Membership in both groups isolates relationship integrity from RLS.
        const membership = await fixture.from('group_members').upsert({ group_id: foreignGroup, user_id: process.env.E2E_USER_ID! }, { onConflict: 'group_id,user_id' });
        expect(membership.error).toBeNull();
      } else {
        const membership = await actor.rpc('is_group_member', { p_group_id: foreignGroup, p_user_id: process.env.E2E_USER_ID! });
        expect(membership.error).toBeNull(); expect(membership.data).toBe(false);
      }
      const payload = { id: deckId, group_id: ownGroup, guest_id: operation === 'insert' ? foreignGuest : ownGuest,
        name: 'Guest scope deck', commander: 'Fixture commander' };
      const inserted = await actor.from('arena_guest_decks').insert(payload).select('id');
      if (operation === 'insert') {
        const stored = await fixture.from('arena_guest_decks').select('id').eq('id', deckId);
        expect(stored.error).toBeNull();
        await test.info().attach('guest-scope-insert-result', { contentType: 'application/json',
          body: JSON.stringify({ accepted: inserted.error === null && inserted.data?.length === 1, persistedRows: stored.data?.length,
            code: inserted.error?.code ?? null }) });
        expect(inserted.error?.code).toBe('23503');
      }
      else {
        expect(inserted.error).toBeNull(); expect(inserted.data).toHaveLength(1);
        if (operation === 'cascade') {
          const deleted = await actor.from('arena_guests').delete().eq('id', ownGuest).eq('group_id', ownGroup).select('id');
          expect(deleted.error).toBeNull(); expect(deleted.data).toHaveLength(1);
        } else {
          const changed = await actor.from('arena_guest_decks').update(operation === 'replace-guest' ? { guest_id: foreignGuest } : { group_id: foreignGroup })
            .eq('id', deckId).eq('group_id', ownGroup).select('id');
          expect(changed.error?.code).toBe('23503');
        }
      }
      const persisted = await fixture.from('arena_guest_decks').select('guest_id,group_id').eq('id', deckId);
      expect(persisted.error).toBeNull();
      expect(persisted.data).toEqual(operation === 'insert' || operation === 'cascade' ? [] : [{ guest_id: ownGuest, group_id: ownGroup }]);
    } finally {
      const deckCleanup = await fixture.from('arena_guest_decks').delete().eq('id', deckId);
      expect(deckCleanup.error).toBeNull();
      const guestCleanup = await fixture.from('arena_guests').delete().eq('id', ownGuest).eq('group_id', ownGroup);
      expect(guestCleanup.error).toBeNull();
      const groupCleanup = await fixture.from('groups').delete().eq('id', foreignGroup);
      expect(groupCleanup.error).toBeNull();
      const [decks, guests, groups] = await Promise.all([
        fixture.from('arena_guest_decks').select('id').eq('id', deckId),
        fixture.from('arena_guests').select('id').in('id', [ownGuest, foreignGuest]),
        fixture.from('groups').select('id').eq('id', foreignGroup),
      ]);
      for (const result of [decks, guests, groups]) { expect(result.error).toBeNull(); expect(result.data).toEqual([]); }
    }
  });
}
