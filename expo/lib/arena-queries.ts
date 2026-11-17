import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArenaGuest } from '@/lib/arena-participants';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import type { ArenaDetail, MemberDeck } from '@/lib/types/arena';

const DECK_PICKER_COLUMNS = `
  id,
  user_id,
  group_id,
  name,
  commander,
  commander_image,
  source_url,
  source_type,
  bracket,
  color_identity,
  is_favorite,
  created_at
`;

const MEMBER_DECK_LIMIT = 120;
const MEMBER_FETCH_CONCURRENCY = 4;

export async function fetchArenaGroup(supabase: SupabaseClient, groupId: string) {
  const { data, error } = await supabase
    .from('groups')
    .select(`
      *,
      profiles:created_by (id, username, display_name),
      group_members (
        user_id,
        profiles (id, username, display_name, archidekt_auto_import)
      )
    `)
    .eq('id', groupId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as ArenaDetail | null;
}

export async function fetchArenaGuests(supabase: SupabaseClient, groupId: string) {
  const { data, error } = await supabase
    .from('arena_guests')
    .select(`
      id,
      group_id,
      display_name,
      last_played_at,
      arena_guest_decks (
        id,
        guest_id,
        group_id,
        name,
        commander,
        commander_image,
        color_identity,
        bracket,
        created_at
      )
    `)
    .eq('group_id', groupId)
    .order('last_played_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('Error fetching guests:', getSupabaseErrorMessage(error, 'Failed to fetch guests'));
    return [] as ArenaGuest[];
  }

  return (data as ArenaGuest[]) || [];
}

export async function fetchArenaMemberDecks(
  supabase: SupabaseClient,
  groupId: string,
  memberIds: string[],
  options?: { strict?: boolean },
) {
  if (memberIds.length === 0) return [] as MemberDeck[];

  const { data, error } = await supabase.rpc('get_arena_member_decks', {
    p_group_id: groupId,
    p_user_ids: memberIds,
    p_limit_per_user: MEMBER_DECK_LIMIT,
  });
  if (!error) {
    if (options?.strict && !Array.isArray(data)) throw new Error('ARENA_DECKS_READ_FAILED');
    return ((data || []) as MemberDeck[]).filter((deck) => deck.source_type !== 'occasional');
  }

  // Compatibility fallback while a new deployment is waiting for migrations.
  const decks: MemberDeck[] = [];

  for (let index = 0; index < memberIds.length; index += MEMBER_FETCH_CONCURRENCY) {
    const chunk = memberIds.slice(index, index + MEMBER_FETCH_CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(async (memberId) => {
      const { data, error } = await supabase
        .from('decks')
        .select(DECK_PICKER_COLUMNS)
        .eq('user_id', memberId)
        .or('source_type.is.null,source_type.neq.occasional')
        .order('is_favorite', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(MEMBER_DECK_LIMIT);

      if (error) {
        if (options?.strict) throw new Error('ARENA_DECKS_READ_FAILED');
        console.error('Error fetching member decks:', getSupabaseErrorMessage(error, 'Failed to fetch member decks'));
        return [] as MemberDeck[];
      }

      return (data || []) as MemberDeck[];
    }));

    decks.push(...chunkResults.flat());
  }

  return decks;
}
