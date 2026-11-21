import { supabase } from '@/lib/supabase';
import type { Deck } from '@/lib/types/arena-catalog';

const ARENA_DECK_PICKER_COLUMNS = `
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

const ARENA_MEMBER_DECK_LIMIT = 120;
const ARENA_MEMBER_FETCH_CONCURRENCY = 4;

export async function fetchArenaMemberDecks(groupId: string, memberIds: string[], parent: AbortSignal) {
  parent.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener('abort', abort, { once: true });
  try { return await readMemberDecks(groupId, memberIds, controller.signal); }
  finally { parent.removeEventListener('abort', abort); controller.abort(); }
}

async function readMemberDecks(groupId: string, memberIds: string[], signal: AbortSignal) {
  signal.throwIfAborted();
  if (memberIds.length === 0) return [] as Deck[];

  const { data, error } = await supabase.rpc('get_arena_member_decks', {
    p_group_id: groupId,
    p_user_ids: memberIds,
    p_limit_per_user: ARENA_MEMBER_DECK_LIMIT,
  }).abortSignal(signal);
  signal.throwIfAborted();
  if (!error) return (data || []) as Deck[];

  // Only a missing RPC may use the legacy compatibility path. Transport,
  // permission and server errors must not become a partial/empty catalog.
  if (error.code !== 'PGRST202' && error.code !== '42883') throw error;

  // Compatibility fallback while a new deployment is waiting for migrations.
  const decks: Deck[] = [];

  for (let index = 0; index < memberIds.length; index += ARENA_MEMBER_FETCH_CONCURRENCY) {
    signal.throwIfAborted();
    const chunk = memberIds.slice(index, index + ARENA_MEMBER_FETCH_CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(async (memberId) => {
      const { data, error } = await supabase
        .from('decks')
        .select(ARENA_DECK_PICKER_COLUMNS)
        .eq('user_id', memberId)
        .is('group_id', null)
        .or('source_type.is.null,source_type.neq.occasional')
        .order('is_favorite', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(ARENA_MEMBER_DECK_LIMIT).abortSignal(signal);
      signal.throwIfAborted();

      if (error) throw error;

      return (data || []) as Deck[];
    }));

    decks.push(...chunkResults.flat());
  }

  return decks;
}

