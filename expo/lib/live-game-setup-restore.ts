import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberDeck } from '@/lib/types/arena';
import { LIVE_GAME_FOREGROUND_TIMEOUT_MS, withLiveGameRequestTimeout } from '@/lib/live-game-async';

export async function restoreSetupDecks(client: SupabaseClient, groupId: string, deckIds: string[], signal?: AbortSignal): Promise<MemberDeck[]> {
 if (!deckIds.length) return [];
 const { data, error } = await withLiveGameRequestTimeout(client.from('decks').select('*').eq('group_id', groupId)
   .eq('source_type', 'occasional').in('id', deckIds), LIVE_GAME_FOREGROUND_TIMEOUT_MS, signal);
 if (error) throw error;
 return (data || []) as MemberDeck[];
}
