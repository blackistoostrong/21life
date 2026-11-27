import type {ArenaHistoryMatch} from '../domain/arena-history';
import {cleanArenaRecapLabel, summarizeArenaRecap, type ArenaRecapMatch} from '../domain/arena-recap';
import type {ArenaRecapPeriod} from '../domain/arena-recap-period';
import {fetchCompleteArenaHistoryPeriod, type ArenaHistoryRpcClient} from './arena-history-query';

function invalid(): never {throw new Error('ARENA_RECAP_CONTRACT_INVALID');}
function object(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function label(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? cleanArenaRecapLabel(value) || null : invalid();
}
function count(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}

/** Whitelist before aggregation: notes, emails, invitation codes, logs and links never enter the recap model. */
export function projectArenaRecapMatches(matches: readonly ArenaHistoryMatch[]): ArenaRecapMatch[] {
  return matches.map(match => {
    if (match.played_at === null) return invalid();
    const metadata: Readonly<Record<string, unknown>> = match;
    return {
      id: match.id, playedAt: match.played_at, isDraw: match.is_draw,
      durationSeconds: count(metadata.duration_seconds), trackingVersion: count(metadata.tracking_version),
      participants: match.match_participants.map(participant => {
        if (participant.user_id !== null && participant.guest_id !== null) return invalid();
        const fields: Readonly<Record<string, unknown>> = participant;
        return {
          identity: participant.guest_id ? `guest:${participant.guest_id}` : participant.user_id ? `user:${participant.user_id}` : null,
          displayName: label(fields.participant_name_snapshot)
            ?? label(object(fields.arena_guests)?.display_name)
            ?? label(object(fields.profiles)?.display_name) ?? label(object(fields.profiles)?.username),
          commander: label(fields.commander_snapshot)
            ?? label(object(fields.decks)?.commander) ?? label(object(fields.arena_guest_decks)?.commander),
          isWinner: participant.is_winner,
        };
      }),
    };
  });
}

export async function readArenaRecap(client: ArenaHistoryRpcClient, groupId: string, period: ArenaRecapPeriod, signal?: AbortSignal) {
  const matches = await fetchCompleteArenaHistoryPeriod(client, {groupId, since: period.since, until: period.until}, signal);
  return summarizeArenaRecap(projectArenaRecapMatches(matches));
}
