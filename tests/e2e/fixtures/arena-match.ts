import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect } from '@playwright/test';

export async function seedArenaMatch() {
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

