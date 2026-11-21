import type { ParticipantKey } from './participant-keys';
export type TableLayoutVariant = 'classic' | 'opposed';

export const LIVE_GAME_MIN_PLAYERS = 2;
export const LIVE_GAME_MAX_PLAYERS = 6;
export const COMMANDER_DAMAGE_LIMIT = 21;
export const INFECT_LOSS_THRESHOLD = 10;
export const LIVE_GAME_HIGHLIGHT_LIMIT = 24;

export type LiveGameStatus = 'setup' | 'active' | 'ended' | 'cancelled';
export type DamageMode = 'life' | 'commander' | 'infect';
export type GroupDamageScope = 'opponents' | 'all_players';
export type PlayDirection = 'clockwise' | 'counterclockwise';
export type PlayerCounter = 'energy' | 'experience' | 'commanderTax';
export type PlayerEmblem = 'monarch' | 'initiative';
export interface LiveGamePlayerCounters {
  energy: number;
  experience: number;
  commanderTax: number;
  monarch: boolean;
  initiative: boolean;
}
export type WinCondition = 'last_standing' | 'combo' | 'concession' | 'alternate_card' | 'other';
export type LiveGameEventDirection = 'increase' | 'decrease';
export type LiveGameEventType =
  | 'damage'
  | 'commander_damage'
  | 'infect'
  | 'lifegain'
  | 'elimination'
  | 'revive'
  | 'correction';

export interface LiveGameEvent {
  id: string;
  type: LiveGameEventType;
  occurredAt: string;
  targetKey: ParticipantKey;
  sourceKey: ParticipantKey | null;
  amount: number | null;
  /** Direction of the tracked counter. Missing on legacy events. */
  direction?: LiveGameEventDirection;
  /** Links the per-target events produced by one atomic table-wide action. */
  actionId?: string;
  groupScope?: GroupDamageScope;
  /** Marks an undo event so compact analytics reverse the original counter. */
  isCorrection?: boolean;
}

export interface LiveGameParticipantSummary {
  eventCount: number;
  lifeLost: number;
  lifeGained: number;
  lifeDamageDealt: number;
  unattributedLifeLost: number;
  commanderDamageTaken: number;
  commanderDamageDealt: number;
  infectReceived: number;
  infectDealt: number;
  eliminations: number;
  eliminationsCaused: number;
  revives: number;
  corrections: number;
  groupDamageDealt: number;
  groupDamageEvents: number;
}

export interface LiveGameSummary {
  schemaVersion: 1;
  totalEvents: number;
  firstOccurredAt: string | null;
  lastOccurredAt: string | null;
  byParticipant: Partial<Record<ParticipantKey, LiveGameParticipantSummary>>;
}

export interface LiveGamePlayer {
  slot: number;
  participantKey: ParticipantKey;
  deckId: string;
  displayName: string;
  commander: string;
  commanderImage: string | null;
  backgroundColor?: string | null;
  life: number;
  infect: number;
  commanderDamageFrom: Record<ParticipantKey, number>;
  counters: LiveGamePlayerCounters;
  isEliminated: boolean;
  eliminatedAt: string | null;
}

export interface LiveGameState {
  version: number;
  players: LiveGamePlayer[];
  layoutVariant?: TableLayoutVariant;
  startingPlayerKey?: ParticipantKey | null;
  startingDirection?: PlayDirection | null;
  /** Significant moments only. Routine counter changes live in `summary`. */
  events: LiveGameEvent[];
  /** Bounded cumulative counters used for per-match and future per-deck analytics. */
  summary?: LiveGameSummary;
}

type LiveGameMutationMetadata = {
  eventId?: string;
  occurredAt?: string;
  actionId?: string;
  isCorrection?: boolean;
};

export type LiveGameMutation = (
  | {
      type: 'adjust';
      targetKey: ParticipantKey;
      amount: number;
      mode: DamageMode;
      sourceKey?: ParticipantKey;
      /** Gain life equal to the damage actually dealt, including commander damage. */
      drain?: boolean;
      /** Fixed amount used when reversing a drain action. */
      drainAmount?: number;
      /** Internal metadata set by adjust_many for compact analytics. */
      groupScope?: GroupDamageScope;
    }
  | {
      type: 'adjust_many';
      sourceKey: ParticipantKey;
      amount: number;
      scope: GroupDamageScope;
      mode?: 'life' | 'infect';
      drain?: boolean;
      drainAmount?: number;
    }
  | { type: 'last_standing'; winnerKey: ParticipantKey }
  | { type: 'eliminate'; targetKey: ParticipantKey; eliminatedAt: string }
  | { type: 'revive'; targetKey: ParticipantKey; startingLife: number }
  | { type: 'restore-player'; player: LiveGamePlayer }
  | { type: 'adjust_counter'; targetKey: ParticipantKey; counter: PlayerCounter; amount: number }
  | { type: 'set_emblem'; targetKey: ParticipantKey; emblem: PlayerEmblem; active: boolean }
  | { type: 'restore_emblem'; emblem: PlayerEmblem; holderKey: ParticipantKey | null }
) & LiveGameMutationMetadata;

export interface QueuedLiveGameMutation {
  id: string;
  mutation: LiveGameMutation;
}

export interface LiveGameRecord {
  id: string;
  group_id: string;
  created_by: string;
  status: LiveGameStatus;
  starting_life: number;
  state: LiveGameState;
  match_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}
