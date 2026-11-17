import type { LiveGameEventDirection, LiveGameEvent, LiveGameParticipantSummary, LiveGameSummary } from './live-game-types';
import { LIVE_GAME_HIGHLIGHT_LIMIT } from './live-game-types';
import type { ParticipantKey } from './participant-keys';

export function emptyParticipantSummary(): LiveGameParticipantSummary {
  return {
    eventCount: 0,
    lifeLost: 0,
    lifeGained: 0,
    lifeDamageDealt: 0,
    unattributedLifeLost: 0,
    commanderDamageTaken: 0,
    commanderDamageDealt: 0,
    infectReceived: 0,
    infectDealt: 0,
    eliminations: 0,
    eliminationsCaused: 0,
    revives: 0,
    corrections: 0,
    groupDamageDealt: 0,
    groupDamageEvents: 0,
  };
}

export function createLiveGameSummary(): LiveGameSummary {
  return {
    schemaVersion: 1,
    totalEvents: 0,
    firstOccurredAt: null,
    lastOccurredAt: null,
    byParticipant: {},
  };
}

function incrementMetric(
  metrics: LiveGameParticipantSummary,
  key: keyof LiveGameParticipantSummary,
  amount: number,
) {
  metrics[key] = Math.max(0, metrics[key] + amount);
}

export function aggregateLiveGameEvent(
  current: LiveGameSummary | undefined,
  event: LiveGameEvent,
): LiveGameSummary {
  const summary = current ?? createLiveGameSummary();
  const byParticipant = { ...summary.byParticipant };
  const getMetrics = (key: ParticipantKey) => {
    const metrics = { ...(byParticipant[key] ?? emptyParticipantSummary()) };
    byParticipant[key] = metrics;
    return metrics;
  };
  const target = getMetrics(event.targetKey);
  const amount = Math.max(0, event.amount ?? 0);
  const defaultDirection: LiveGameEventDirection = event.type === 'damage' ? 'decrease' : 'increase';
  const direction = event.direction ?? defaultDirection;
  const delta = direction === 'decrease' ? -amount : amount;

  target.eventCount += 1;
  if (event.isCorrection && event.type === 'damage') {
    incrementMetric(target, 'lifeGained', -amount);
    target.corrections += 1;
  } else if (event.isCorrection && event.type === 'lifegain') {
    incrementMetric(target, 'lifeLost', -amount);
    if (!event.sourceKey) incrementMetric(target, 'unattributedLifeLost', -amount);
    target.corrections += 1;
  } else if (event.type === 'damage') {
    incrementMetric(target, 'lifeLost', amount);
    if (!event.sourceKey) incrementMetric(target, 'unattributedLifeLost', amount);
  } else if (event.type === 'lifegain') {
    incrementMetric(target, 'lifeGained', delta);
  } else if (event.type === 'commander_damage') {
    incrementMetric(target, 'lifeLost', delta);
    incrementMetric(target, 'commanderDamageTaken', delta);
    if (direction === 'decrease') target.corrections += 1;
  } else if (event.type === 'infect') {
    incrementMetric(target, 'infectReceived', delta);
    if (direction === 'decrease') target.corrections += 1;
  } else if (event.type === 'elimination') {
    target.eliminations += 1;
  } else if (event.type === 'revive') {
    target.revives += 1;
  } else if (event.type === 'correction') {
    target.corrections += 1;
  }

  if (event.sourceKey) {
    const source = getMetrics(event.sourceKey);
    if (event.isCorrection && event.type === 'lifegain') {
      incrementMetric(source, 'lifeDamageDealt', -amount);
      if (event.groupScope) {
        incrementMetric(source, 'groupDamageDealt', -amount);
        incrementMetric(source, 'groupDamageEvents', -1);
      }
    } else if (event.type === 'damage') {
      incrementMetric(source, 'lifeDamageDealt', amount);
      if (event.groupScope) {
        incrementMetric(source, 'groupDamageDealt', amount);
        source.groupDamageEvents += 1;
      }
    } else if (event.type === 'commander_damage') {
      incrementMetric(source, 'lifeDamageDealt', delta);
      incrementMetric(source, 'commanderDamageDealt', delta);
    } else if (event.type === 'infect') {
      incrementMetric(source, 'infectDealt', delta);
    } else if (event.type === 'elimination') {
      source.eliminationsCaused += 1;
    }
  }

  return {
    schemaVersion: 1,
    totalEvents: summary.totalEvents + 1,
    firstOccurredAt: !summary.firstOccurredAt || event.occurredAt < summary.firstOccurredAt
      ? event.occurredAt
      : summary.firstOccurredAt,
    lastOccurredAt: !summary.lastOccurredAt || event.occurredAt > summary.lastOccurredAt
      ? event.occurredAt
      : summary.lastOccurredAt,
    byParticipant,
  };
}

export function summarizeLiveGameEvents(events: LiveGameEvent[]): LiveGameSummary {
  return events.reduce<LiveGameSummary>(aggregateLiveGameEvent, createLiveGameSummary());
}

export function isLiveGameHighlight(event: Pick<LiveGameEvent, 'type'>): boolean {
  return event.type === 'elimination' || event.type === 'revive';
}

export function compactLiveGameHighlights(events: LiveGameEvent[]): LiveGameEvent[] {
  return events.filter(isLiveGameHighlight).slice(-LIVE_GAME_HIGHLIGHT_LIMIT);
}
