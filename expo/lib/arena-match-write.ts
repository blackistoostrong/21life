import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteArenaMatch as removeMatch } from '../../packages/data/arena-match-delete';

export function deleteArenaMatch(client: SupabaseClient, groupId: string, matchId: string, signal?: AbortSignal) {
  return removeMatch({ remove: (group, id, requestSignal) => client.from('matches').delete()
    .eq('id', id).eq('group_id', group).select('id').abortSignal(requestSignal) }, groupId, matchId, signal);
}
