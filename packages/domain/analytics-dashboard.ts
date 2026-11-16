import { buildMatchRecord, type MatchRecord } from './win-rate';

export interface AnalyticsDeckCard extends MatchRecord {
  id: string;
  name: string;
  commander: string;
  commanderImage: string | null;
  ownerUsername: string | null;
  colors: string[];
  historical: boolean;
}
export interface AnalyticsCounts { gamesPlayed: number; wins: number; draws: number }
export interface AnalyticsDeckRollup extends AnalyticsCounts {
  id: string;
  name: string;
  commander: string;
  commanderImage: string | null;
  ownerUsername: string | null;
  colors: string[];
  historical: boolean;
}
export interface AnalyticsDashboardPayload {
  schemaVersion: 2;
  complete: true;
  asOf: string;
  scope: 'personal' | 'global';
  period: { since: string | null; until: string | null; bracket: string | null };
  totals: AnalyticsCounts & { matches: number; unlinkedDeckGames: number; unknownColorGames: number };
  uniqueDecks: number;
  topDecks: AnalyticsDeckRollup[];
  bestDeck: AnalyticsDeckRollup | null;
  colors: Array<AnalyticsCounts & { colors: string[] }>;
  bracketWins: Array<{ bracket: string; wins: number }>;
  winConditions: Array<{ condition: string; wins: number }>;
  chronologyComplete: boolean;
  streaks: { longest: number; current: number };
}
export interface AnalyticsSample {
  schemaVersion: 2;
  complete: true;
  asOf: string;
  scope: 'personal' | 'global';
  period: AnalyticsDashboardPayload['period'];
  matches: number;
  unlinkedDeckGames: number;
  unknownColorGames: number;
  chronologyComplete: boolean;
}

/** All input counts already cover the full filtered dataset. No expanded facts. */
export function buildAnalyticsDashboard(payload: AnalyticsDashboardPayload) {
  const colors = new Map<string, AnalyticsCounts>();
  for (const group of payload.colors) for (const color of group.colors) {
    const previous = colors.get(color) ?? { gamesPlayed: 0, wins: 0, draws: 0 };
    colors.set(color,{ gamesPlayed: previous.gamesPlayed + group.gamesPlayed, wins: previous.wins + group.wins, draws: previous.draws + group.draws });
  }
  const colorTotal = Array.from(colors.values()).reduce((total,value) => total + value.gamesPlayed,0);
  const trackedWins = payload.winConditions.reduce((total,value) => total + value.wins,0);
  const card = (value: AnalyticsDeckRollup): AnalyticsDeckCard => ({ ...value, ...buildMatchRecord(value) });
  const sample: AnalyticsSample = { schemaVersion: 2, complete: true, asOf: payload.asOf, scope: payload.scope, period: payload.period,
    matches: payload.totals.matches, unlinkedDeckGames: payload.totals.unlinkedDeckGames,
    unknownColorGames: payload.totals.unknownColorGames, chronologyComplete: payload.chronologyComplete };
  return {
    ...buildMatchRecord(payload.totals),
    uniqueDecks: payload.uniqueDecks,
    topDecks: payload.topDecks.map(card),
    bestDeck: payload.bestDeck ? card(payload.bestDeck) : null,
    colorStats: Array.from(colors).map(([color,value]) => ({ color, gamesPlayed: value.gamesPlayed,
      percentage: colorTotal ? Math.round(100 * value.gamesPlayed / colorTotal) : 0 }))
      .sort((a,b) => b.gamesPlayed - a.gamesPlayed || a.color.localeCompare(b.color)),
    colorWinStats: Array.from(colors).map(([color,value]) => ({ color, ...buildMatchRecord(value) }))
      .sort((a,b) => b.winRate - a.winRate || b.wins - a.wins || b.gamesPlayed - a.gamesPlayed || a.color.localeCompare(b.color)),
    bracketWins: [...payload.bracketWins].sort((a,b) => b.wins - a.wins || a.bracket.localeCompare(b.bracket,undefined,{ numeric: true })),
    winConditions: payload.winConditions.map(value => ({ ...value, percentage: trackedWins ? Math.round(100 * value.wins / trackedWins) : 0 }))
      .sort((a,b) => b.wins - a.wins || a.condition.localeCompare(b.condition)),
    longestWinStreak: payload.streaks.longest,
    currentWinStreak: payload.streaks.current,
    sample,
  };
}
