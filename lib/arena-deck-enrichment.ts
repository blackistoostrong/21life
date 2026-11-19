import { supabase } from '@/lib/supabase';
import type { Deck } from '@/lib/types/arena-catalog';
import type { MatchParticipantRecord } from '@/lib/arena-participants';
import type { DeckCommanderColorTarget } from '@/lib/deck-color-sync';
import { withRequestDeadline } from '@/packages/data/request-deadline';

export type ArenaColorMatch = { match_participants: MatchParticipantRecord[] };
export type EnrichmentPatch = Partial<Pick<Deck, 'name' | 'commander' | 'commander_image' | 'bracket'>>;
const SOURCE_FIELDS = ['id', 'user_id', 'group_id', 'name', 'commander', 'source_type', 'source_url', 'commander_image', 'bracket'] as const;

export function sameArenaEnrichmentSource(current: Deck, snapshot: Deck) {
  return SOURCE_FIELDS.every(field => current[field] === snapshot[field]);
}

/** A background import may fill its snapshot, never overwrite a newer edit. */
export async function persistArenaEnrichment(snapshot: Deck, patch: EnrichmentPatch, signal: AbortSignal) {
  signal.throwIfAborted();
  const { data, error } = await withRequestDeadline({ abortSignal: transport => {
    let query = supabase.from('decks').update(patch).eq('id', snapshot.id).eq('user_id', snapshot.user_id)
      .eq('name', snapshot.name).eq('commander', snapshot.commander);
    for (const field of ['group_id', 'source_type', 'source_url', 'commander_image', 'bracket'] as const) {
      query = snapshot[field] === null ? query.is(field, null) : query.eq(field, snapshot[field]);
    }
    return query.select('id').abortSignal(transport);
  } }, 15000, signal);
  signal.throwIfAborted();
  if (error) throw error;
  return Array.isArray(data) && data.some(row => row.id === snapshot.id);
}

export function buildArenaColorTargets(ids: string[], decks: Deck[], overrides: Record<string, string[]>, matches: ArenaColorMatch[]) {
  const byId = new Map(decks.map(deck => [deck.id, deck]));
  const targets: DeckCommanderColorTarget[] = [];
  for (const id of Array.from(new Set(ids.filter(Boolean)))) {
    if (overrides[id]?.length) continue;
    const deck = byId.get(id);
    if (deck && (deck.color_identity?.length || deck.commander?.trim())) { targets.push(deck); continue; }
    for (const match of matches) {
      const participant = match.match_participants.find(row => row.deck_id === id || row.guest_deck_id === id);
      const snapshot = participant?.decks || participant?.arena_guest_decks;
      if (!snapshot?.commander?.trim()) continue;
      targets.push({ id, commander: snapshot.commander, source_type: participant?.decks?.source_type ?? null,
        source_url: null, color_identity: snapshot.color_identity });
      break;
    }
  }
  return targets;
}
