import type {SupabaseClient} from '@supabase/supabase-js';
import type {LiveGameReferenceReader} from '../../packages/data/live-game-round-references';
import {LIVE_GAME_REFERENCE_COLUMNS as columns} from '../../packages/data/live-game-round-references';

/** Native SDK adapter; callers supply their captured client, never a singleton. */
export function createLiveGameReferenceReader(client:SupabaseClient):LiveGameReferenceReader{
  return{
    group:(groupId,userIds,signal)=>client.from('groups')
      .select(columns.group).eq('id',groupId)
      .in('group_members.user_id',userIds).abortSignal(signal).maybeSingle(),
    decks:(ids,signal)=>client.from('decks')
      .select(columns.deck).in('id',ids).abortSignal(signal),
    guests:(groupId,ids,signal)=>client.from('arena_guests')
      .select(columns.guest).eq('group_id',groupId).in('id',ids).abortSignal(signal),
    guestDecks:(groupId,ids,signal)=>client.from('arena_guest_decks')
      .select(columns.guestDeck).eq('group_id',groupId).in('id',ids).abortSignal(signal),
  };
}
