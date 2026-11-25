import { createLiveGamePlayer } from './live-game-players';
import { createLiveGameSummary } from './live-game-events';
import type { LiveGamePlayer, LiveGameRecord, TableLayoutVariant } from './live-game-types';

export type LiveGameRoundSeat = Pick<LiveGamePlayer,
  'participantKey' | 'deckId' | 'displayName' | 'commander' | 'commanderImage'>;

/** Start and rematch share a fresh state; clock, identity and RNG belong to adapters. */
export function createLiveGameRound(input: {
  id: string; groupId: string; actorId: string; startedAt: string;
  startingLife: number; layoutVariant: TableLayoutVariant;
  seats: readonly LiveGameRoundSeat[]; random: () => number;
}): LiveGameRecord {
  const allParticipantKeys = input.seats.map(seat => seat.participantKey);
  const players = input.seats.map((seat, slot) => createLiveGamePlayer({
    slot, participantKey: seat.participantKey, deckId: seat.deckId,
    displayName: seat.displayName, commander: seat.commander, commanderImage: seat.commanderImage,
    startingLife: input.startingLife, allParticipantKeys,
  }));
  const startingPlayer = players[Math.floor(input.random() * players.length)];
  return {
    id: input.id, group_id: input.groupId, created_by: input.actorId, status: 'active',
    starting_life: input.startingLife,
    state: {
      version: 0, players, layoutVariant: input.layoutVariant,
      startingPlayerKey: startingPlayer?.participantKey ?? null,
      startingDirection: input.random() < 0.5 ? 'clockwise' : 'counterclockwise',
      events: [], summary: createLiveGameSummary(),
    },
    match_id: null, started_at: input.startedAt, ended_at: null,
    created_at: input.startedAt, updated_at: input.startedAt,
  };
}
