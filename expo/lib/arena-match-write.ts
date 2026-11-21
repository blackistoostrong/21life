import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteArenaMatch as removeMatch } from '../../packages/data/arena-match-delete';
import { saveArenaMatch as saveMatch, type ArenaMatchWriteCommand } from '../../packages/data/arena-match-write';
export type { ArenaMatchWriteCommand } from '../../packages/data/arena-match-write';

export function deleteArenaMatch(client: SupabaseClient, groupId: string, matchId: string, signal?: AbortSignal) {
  return removeMatch({ remove: (group, id, requestSignal) => client.from('matches').delete()
    .eq('id', id).eq('group_id', group).select('id').abortSignal(requestSignal) }, groupId, matchId, signal);
}

export function saveArenaMatch(client: SupabaseClient, command: ArenaMatchWriteCommand, signal?: AbortSignal) {
  return saveMatch({ rpc: (name, args) => client.rpc(name, args) }, command, signal);
}
