import type { LiveGameEvent, LiveGameParticipantSummary, LiveGameSummary, LiveGamePlayer, LiveGameState } from './live-game-types';
import type { ParticipantKey } from './participant-keys';
import { emptyParticipantSummary, summarizeLiveGameEvents, compactLiveGameHighlights } from './live-game-events';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeLiveGamePlayer(raw: unknown): LiveGamePlayer | null {
  if (!isRecord(raw)) return null;
  const player = raw as Partial<LiveGamePlayer>;
  const participantKey = typeof player.participantKey === 'string' ? player.participantKey : '';
  // The participant projection only accepts keys in this range (see the
  // live_games trigger); drop the row instead of creating a seat keyed by
  // `undefined`, which would break every keyed lookup at the table.
  if (participantKey.length < 6 || participantKey.length > 64) return null;
  const commanderDamageFrom = Object.fromEntries(
    Object.entries(isRecord(player.commanderDamageFrom) ? player.commanderDamageFrom : {})
      .filter(([key]) => key.length > 0)
      .map(([key, damage]) => [key, nonNegativeNumber(damage)]),
  ) as Record<ParticipantKey, number>;
  return {
    ...(player as LiveGamePlayer),
    participantKey: participantKey as ParticipantKey,
    slot: typeof player.slot === 'number' && Number.isFinite(player.slot) ? player.slot : 0,
    deckId: typeof player.deckId === 'string' ? player.deckId : '',
    displayName: typeof player.displayName === 'string' && player.displayName
      ? player.displayName
      : participantKey,
    commander: typeof player.commander === 'string' ? player.commander : '',
    commanderImage: typeof player.commanderImage === 'string' ? player.commanderImage : null,
    life: typeof player.life === 'number' && Number.isFinite(player.life) ? player.life : 0,
    infect: nonNegativeNumber(player.infect),
    commanderDamageFrom,
    counters: {
      energy: nonNegativeNumber(player.counters?.energy),
      experience: nonNegativeNumber(player.counters?.experience),
      commanderTax: nonNegativeNumber(player.counters?.commanderTax),
      monarch: Boolean(player.counters?.monarch),
      initiative: Boolean(player.counters?.initiative),
    },
    isEliminated: Boolean(player.isEliminated),
    eliminatedAt: typeof player.eliminatedAt === 'string' ? player.eliminatedAt : null,
  };
}

/**
 * Normalizes every persisted player field. Renderers and event handlers read
 * `counters` and `commanderDamageFrom` directly, so a legacy or partially
 * written row must never surface as an undefined dereference at the table.
 */
export function parseLiveGameState(raw: unknown): LiveGameState {
  if (!isRecord(raw)) return { version: 0, players: [], events: [] };
  const value = raw as Partial<LiveGameState>;
  const events = Array.isArray(value.events)
    ? value.events.filter(isRecord) as unknown as LiveGameEvent[]
    : [];
  const summaryValue = isRecord(value.summary) ? value.summary as Partial<LiveGameSummary> : null;
  const summary: LiveGameSummary = summaryValue?.schemaVersion === 1
    ? {
        schemaVersion: 1,
        totalEvents: nonNegativeNumber(summaryValue.totalEvents),
        firstOccurredAt: typeof summaryValue.firstOccurredAt === 'string' ? summaryValue.firstOccurredAt : null,
        lastOccurredAt: typeof summaryValue.lastOccurredAt === 'string' ? summaryValue.lastOccurredAt : null,
        byParticipant: Object.fromEntries(
          Object.entries(isRecord(summaryValue.byParticipant) ? summaryValue.byParticipant : {})
            .filter(([, metrics]) => isRecord(metrics))
            .map(([key, metrics]) => [
              key,
              { ...emptyParticipantSummary(), ...(metrics as Partial<LiveGameParticipantSummary>) },
            ]),
        ) as Partial<Record<ParticipantKey, LiveGameParticipantSummary>>,
      }
    : summarizeLiveGameEvents(events);
  return {
    version: nonNegativeNumber(value.version),
    players: Array.isArray(value.players)
      ? value.players.map(normalizeLiveGamePlayer).filter((player): player is LiveGamePlayer => player !== null)
      : [],
    layoutVariant: value.layoutVariant === 'opposed' ? 'opposed' : 'classic',
    startingPlayerKey: typeof value.startingPlayerKey === 'string'
      ? value.startingPlayerKey as ParticipantKey
      : null,
    startingDirection: value.startingDirection === 'clockwise' || value.startingDirection === 'counterclockwise'
      ? value.startingDirection
      : null,
    events: compactLiveGameHighlights(events),
    summary,
  };
}
