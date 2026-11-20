import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

type Participant = { id?: string; user_id: string | null; guest_id: string | null; deck_id: string | null; guest_deck_id: string | null; is_winner: boolean };
const cases = ['create-replay', 'concurrent-replay', 'replay-conflict', 'invalid-create', 'invalid-edit',
  'foreign-participant', 'actor-mismatch', 'forbidden-group', 'replacement-denied', 'unknown-date', 'guest-winner', 'duplicate-player', 'anonymous'] as const;

for (const scenario of cases) {
  test(`arena match atomic API ${scenario} preserves real Dev invariants`, async () => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    if (new URL(backend).hostname !== process.env.STAGING_SUPABASE_DOMAIN) throw new Error('Dev fixture required');
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(backend, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
    const actor = createClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { accessToken: async () => process.env.E2E_ACCESS_TOKEN! });
    const other = createClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options);
    const userId = process.env.E2E_USER_ID!, secondId = process.env.E2E_SECOND_USER_ID!, groupId = process.env.E2E_GROUP_ID!;
    const matchId = randomUUID(), guestId = randomUUID(), foreignGroup = randomUUID(), secondMatch = randomUUID();
    const matchIds = [matchId, secondMatch];
    const header = { is_draw: true, winner_id: null as string | null, winner_guest_id: null as string | null,
      notes: 'Atomic match fixture', played_at: new Date().toISOString() as string | null, win_condition: null };
    const participants: Participant[] = [userId, secondId].map(user_id => ({ user_id, guest_id: null, deck_id: null, guest_deck_id: null, is_winner: false }));
    const input = { p_actor_id: userId, p_group_id: groupId, p_match_id: matchId, p_match: header, p_participants: participants, p_create: true };
    const read = async () => {
      const [matches, players, notifications] = await Promise.all([
        admin.from('matches').select('id,notes,played_at,winner_id,winner_guest_id,is_draw').eq('id', matchId),
        admin.from('match_participants').select('id,user_id,guest_id,deck_id,guest_deck_id,is_winner').eq('match_id', matchId).order('id'),
        admin.from('app_notifications').select('id').eq('data->>matchId', matchId),
      ]);
      for (const result of [matches, players, notifications]) expect(result.error).toBeNull();
      return { matches: matches.data!, players: players.data!, notifications: notifications.data! };
    };
    const unchanged = async () => {
      const saved = await read(); expect(saved.matches).toHaveLength(1); expect(saved.players).toHaveLength(2);
      expect(saved.matches[0].notes).toBe(header.notes); return saved;
    };
    try {
      const preferences = await admin.from('notification_preferences').upsert([userId, secondId].map(user_id => ({ user_id, match_completed: true })), { onConflict: 'user_id' });
      expect(preferences.error).toBeNull();
      if (['actor-mismatch', 'forbidden-group', 'invalid-create', 'duplicate-player', 'anonymous'].includes(scenario)) {
        if (scenario === 'forbidden-group') {
          const group = await admin.from('groups').insert({ id: foreignGroup, name: 'Atomic foreign fixture', created_by: secondId });
          expect(group.error).toBeNull(); input.p_group_id = foreignGroup;
        }
        if (scenario === 'actor-mismatch') input.p_actor_id = secondId;
        if (scenario === 'invalid-create') input.p_participants = [{ ...participants[0], deck_id: randomUUID() }, participants[1]];
        if (scenario === 'duplicate-player') input.p_participants = [participants[0], participants[0]];
        const result = await (scenario === 'anonymous' ? other : actor).rpc('save_arena_match_v1', input);
        expect(result.error).not.toBeNull();
        expect(['invalid-create', 'duplicate-player'].includes(scenario) ? ['23503', '23514'] : ['42501']).toContain(result.error?.code);
        const saved = await read(); expect(saved.matches).toEqual([]); expect(saved.players).toEqual([]); expect(saved.notifications).toEqual([]);
      } else if (scenario === 'guest-winner') {
        const guest = await admin.from('arena_guests').insert({ id: guestId, group_id: groupId, display_name: 'Atomic guest', normalized_name: guestId });
        expect(guest.error).toBeNull();
        input.p_match = { ...header, is_draw: false, winner_guest_id: guestId };
        input.p_participants = [participants[0], { ...participants[1], user_id: null, guest_id: guestId, is_winner: true }];
        const result = await actor.rpc('save_arena_match_v1', input); expect(result.error).toBeNull(); expect(result.data).toBe(matchId);
        const saved = await read(); expect(saved.matches[0].winner_guest_id).toBe(guestId); expect(saved.players).toHaveLength(2);
        expect(saved.notifications).toHaveLength(1);
      } else {
        const results = await Promise.all(Array.from({ length: scenario === 'concurrent-replay' ? 2 : 1 }, () => actor.rpc('save_arena_match_v1', input)));
        for (const result of results) { expect(result.error).toBeNull(); expect(result.data).toBe(matchId); }
        const saved = await unchanged(); expect(saved.notifications).toHaveLength(2);
        if (scenario === 'create-replay') {
          const replay = await actor.rpc('save_arena_match_v1', input); expect(replay.error).toBeNull(); expect(replay.data).toBe(matchId);
          const after = await unchanged(); expect(after.players).toEqual(saved.players); expect(after.notifications).toHaveLength(2);
        } else if (scenario === 'replay-conflict') {
          const replay = await actor.rpc('save_arena_match_v1', { ...input, p_match: { ...header, notes: 'Different command' } });
          expect(replay.error?.code).toBe('PT409'); expect(replay.status).toBe(409); await unchanged();
        } else if (scenario !== 'concurrent-replay') {
          const edit = { ...input, p_create: false, p_match: { ...header, notes: 'Atomic edited fixture' }, p_participants: saved.players };
          if (scenario === 'unknown-date') edit.p_match.played_at = null;
          if (scenario === 'invalid-edit') edit.p_participants = [{ ...saved.players[0], deck_id: randomUUID() }, saved.players[1]];
          if (scenario === 'foreign-participant') {
            const second = await actor.rpc('save_arena_match_v1', { ...input, p_match_id: secondMatch }); expect(second.error).toBeNull();
            const foreign = await admin.from('match_participants').select('id').eq('match_id', secondMatch).limit(1).single();
            expect(foreign.error).toBeNull(); edit.p_participants = [{ ...saved.players[0], id: foreign.data!.id }, saved.players[1]];
          }
          if (scenario === 'replacement-denied') {
            const guest = await admin.from('arena_guests').insert({ id: guestId, group_id: groupId, display_name: 'Atomic replacement guest', normalized_name: guestId });
            expect(guest.error).toBeNull();
            const session = await other.auth.signInWithPassword({ email: process.env.E2E_SECOND_EMAIL!, password: process.env.E2E_PASSWORD! });
            expect(session.error).toBeNull(); expect(session.data.user?.id).toBe(secondId);
            const allowed = await other.rpc('save_arena_match_v1', { ...input, p_actor_id: secondId, p_create: false, p_participants: saved.players });
            expect(allowed.error).toBeNull(); expect(allowed.data).toBe(matchId);
            edit.p_actor_id = secondId;
            edit.p_participants = saved.players.map(participant => participant.user_id === userId ? { ...participant, user_id: null, guest_id: guestId } : participant);
          }
          const result = await (scenario === 'replacement-denied' ? other : actor).rpc('save_arena_match_v1', edit);
          if (scenario === 'unknown-date') {
            expect(result.error).toBeNull(); expect(result.data).toBe(matchId);
            const after = await read(); expect(after.matches[0].notes).toBe(edit.p_match.notes); expect(after.matches[0].played_at).toBeNull();
            expect(after.players).toEqual(saved.players); expect(after.notifications).toHaveLength(2);
          } else {
            expect(result.error).not.toBeNull();
            expect(scenario === 'invalid-edit' ? ['23503', '23514'] : ['42501']).toContain(result.error?.code);
            const after = await unchanged(); expect(after.players).toEqual(saved.players); expect(after.notifications).toHaveLength(2);
          }
        }
      }
    } finally {
      const notifications = await admin.from('app_notifications').delete().in('data->>matchId', matchIds); expect(notifications.error).toBeNull();
      const matches = await admin.from('matches').delete().in('id', matchIds); expect(matches.error).toBeNull();
      const guest = await admin.from('arena_guests').delete().eq('id', guestId); expect(guest.error).toBeNull();
      const group = await admin.from('groups').delete().eq('id', foreignGroup); expect(group.error).toBeNull();
      const [remainingMatches, remainingNotifications] = await Promise.all([
        admin.from('matches').select('id').in('id', matchIds),
        admin.from('app_notifications').select('id').in('data->>matchId', matchIds),
      ]);
      for (const result of [remainingMatches, remainingNotifications]) { expect(result.error).toBeNull(); expect(result.data).toEqual([]); }
    }
  });
}
