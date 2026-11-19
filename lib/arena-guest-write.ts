import { supabase } from '@/lib/supabase';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { buildPairedCommanderColorFields, buildPairedCommanderName } from '@/lib/commander-partners';
import { normalizeGuestName } from '@/lib/participant-keys';
import type { ArenaGuest, ArenaGuestDeck } from '@/lib/arena-participants';
import type { CommanderSearchResult } from '@/lib/scryfall';

export type GuestDeckDraft = {
  groupId: string; name: string; deckName: string; commander: CommanderSearchResult;
  partner: CommanderSearchResult | null; guestId: string | null;
};
const guestFields = 'id, group_id, display_name, last_played_at';
const deckFields = 'id, guest_id, group_id, name, commander, commander_image, color_identity, bracket, created_at';
function request<T>(start: (signal: AbortSignal) => PromiseLike<T>, signal: AbortSignal) {
  return withRequestDeadline({ abortSignal: start }, 15000, signal);
}

/** Retry a partially created guest by its existing unique group/name key. */
async function resolveGuest(input: GuestDeckDraft, guests: ArenaGuest[], signal: AbortSignal): Promise<ArenaGuest> {
  const normalized = normalizeGuestName(input.name);
  if (!normalized) throw new Error('Guest name is required');
  const existing = guests.find(guest => guest.group_id === input.groupId && normalizeGuestName(guest.display_name) === normalized);
  if (existing) return existing;
  const inserted = await request(signal => supabase.from('arena_guests').insert({ group_id: input.groupId,
    display_name: input.name.trim(), normalized_name: normalized }).select(guestFields).abortSignal(signal).single(), signal);
  signal.throwIfAborted();
  // Another client or the previous failed deck step may already have inserted it.
  const result = inserted.error?.code === '23505'
    ? await request(signal => supabase.from('arena_guests').select(guestFields).eq('group_id', input.groupId)
      .eq('normalized_name', normalized).abortSignal(signal).single(), signal) : inserted;
  if (result.error) throw result.error;
  signal.throwIfAborted();
  if (!result.data?.id || result.data.group_id !== input.groupId) throw new Error('Guest was not acknowledged');
  return { ...result.data, arena_guest_decks: [] };
}

export async function saveArenaGuestDeck(input: GuestDeckDraft, guests: ArenaGuest[], signal: AbortSignal): Promise<ArenaGuestDeck> {
  signal.throwIfAborted();
  const guestId = input.guestId ?? (await resolveGuest(input, guests, signal)).id;
  signal.throwIfAborted();
  const commander = buildPairedCommanderName(input.commander, input.partner);
  const { data, error } = await request(signal => supabase.from('arena_guest_decks').insert({
    group_id: input.groupId, guest_id: guestId, name: input.deckName.trim() || commander, commander,
    commander_image: input.commander.imageUrl, ...buildPairedCommanderColorFields(input.commander, input.partner), bracket: null,
  }).select(deckFields).abortSignal(signal).single(), signal);
  if (error) throw error;
  signal.throwIfAborted();
  if (!data?.id || data.group_id !== input.groupId || data.guest_id !== guestId) throw new Error('Guest deck was not acknowledged');
  // This ancillary timestamp must not turn an acknowledged deck into a retryable
  // failed insert. Cancellation still stops the old command and its continuation.
  try {
    await request(signal => supabase.from('arena_guests').update({ last_played_at: new Date().toISOString() })
      .eq('id', guestId).eq('group_id', input.groupId).abortSignal(signal), signal);
  } catch { signal.throwIfAborted(); }
  signal.throwIfAborted();
  return data;
}

export async function deleteArenaGuest(groupId: string, guestId: string, signal: AbortSignal) {
  const { data, error } = await request(signal => supabase.from('arena_guests').delete()
    .eq('id', guestId).eq('group_id', groupId).select('id').abortSignal(signal), signal);
  if (error) throw error;
  signal.throwIfAborted();
  if (!data?.some(row => row.id === guestId)) throw new Error('Guest was not deleted');
}
