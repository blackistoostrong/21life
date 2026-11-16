import type { AnalyticsDashboardPayload, AnalyticsDeckRollup } from '../../packages/domain/analytics-dashboard';

export function analyticsDashboardFixture(): AnalyticsDashboardPayload {
  const deck: AnalyticsDeckRollup = { id: '00000000-0000-4000-8000-000000000001', name: 'Test deck', commander: 'Test commander',
    commanderImage: null, ownerUsername: 'test-player', colors: ['U','W'], historical: false, gamesPlayed: 3, wins: 1, draws: 1 };
  return { schemaVersion: 2, complete: true, asOf: '2026-11-16T12:00:00+00:00', scope: 'personal',
    period: { since: null, until: null, bracket: null }, totals: { gamesPlayed: 3, wins: 1, draws: 1, matches: 3, unlinkedDeckGames: 0, unknownColorGames: 0 },
    uniqueDecks: 1, topDecks: [deck], bestDeck: { ...deck, colors: [...deck.colors] },
    colors: [{ colors: ['U','W'], gamesPlayed: 3, wins: 1, draws: 1 }], bracketWins: [{ bracket: '3', wins: 1 }],
    winConditions: [{ condition: 'combo', wins: 1 }], chronologyComplete: true, streaks: { longest: 1, current: 0 } };
}
