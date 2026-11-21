import type { AnalyticsCounts, AnalyticsDashboardPayload, AnalyticsDeckRollup } from './analytics-dashboard';

function invalid(): never { throw new Error('ANALYTICS_CONTRACT_INVALID'); }
function object(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string,unknown>;
}
function text(value: unknown): string { return typeof value === 'string' ? value : invalid(); }
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function timestamp(value: unknown): string {
  const result = text(value);
  return result.includes('T') && Number.isFinite(Date.parse(result)) ? result : invalid();
}
function nullableTimestamp(value: unknown): string | null { return value === null ? null : timestamp(value); }
function list<T>(value: unknown, parse: (entry: unknown) => T): T[] { return Array.isArray(value) ? Array.from(value,parse) : invalid(); }
function colors(value: unknown): string[] {
  const result = list(value,text);
  if (new Set(result).size !== result.length || result.some(item => !['W','U','B','R','G','C'].includes(item)) || (result.includes('C') && result.length !== 1)) return invalid();
  return result;
}
function counts(value: unknown): AnalyticsCounts {
  const row = object(value);
  const result = { gamesPlayed: count(row.gamesPlayed), wins: count(row.wins), draws: count(row.draws) };
  if (result.wins + result.draws > result.gamesPlayed) return invalid();
  return result;
}
function card(value: unknown): AnalyticsDeckRollup {
  const row = object(value);
  const result = { ...counts(row), id: text(row.id), name: text(row.name), commander: text(row.commander),
    commanderImage: nullableText(row.commanderImage), ownerUsername: nullableText(row.ownerUsername),
    colors: colors(row.colors), historical: boolean(row.historical) };
  if (!result.id || result.gamesPlayed === 0) return invalid();
  return result;
}
function namedCounts(value: unknown, key: 'bracket' | 'condition') {
  const row = object(value);
  const name = text(row[key]);
  if (!name) return invalid();
  return { name, wins: count(row.wins) };
}

/** Reject incomplete, incompatible or internally inconsistent successful responses. */
export function parseAnalyticsDashboard(value: unknown): AnalyticsDashboardPayload {
  const row = object(value);
  if (row.schemaVersion !== 2 || row.complete !== true || (row.scope !== 'personal' && row.scope !== 'global')) return invalid();
  const rawTotals = object(row.totals);
  const period = object(row.period);
  const streaks = object(row.streaks);
  const result: AnalyticsDashboardPayload = {
    schemaVersion: 2, complete: true, asOf: timestamp(row.asOf), scope: row.scope,
    period: { since: nullableTimestamp(period.since), until: nullableTimestamp(period.until), bracket: nullableText(period.bracket) },
    totals: { ...counts(rawTotals), matches: count(rawTotals.matches), unlinkedDeckGames: count(rawTotals.unlinkedDeckGames), unknownColorGames: count(rawTotals.unknownColorGames) },
    uniqueDecks: count(row.uniqueDecks), topDecks: list(row.topDecks,card), bestDeck: row.bestDeck === null ? null : card(row.bestDeck),
    colors: list(row.colors,entry => { const item = object(entry); return { ...counts(item), colors: colors(item.colors) }; }),
    bracketWins: list(row.bracketWins,entry => { const item = namedCounts(entry,'bracket'); return { bracket: item.name, wins: item.wins }; }),
    winConditions: list(row.winConditions,entry => { const item = namedCounts(entry,'condition'); return { condition: item.name, wins: item.wins }; }),
    chronologyComplete: boolean(row.chronologyComplete), streaks: { longest: count(streaks.longest), current: count(streaks.current) },
  };
  const total = result.totals;
  const periodInvalid = result.period.since !== null && result.period.until !== null && Date.parse(result.period.since) >= Date.parse(result.period.until);
  if (periodInvalid || total.matches > total.gamesPlayed || total.unlinkedDeckGames > total.gamesPlayed || total.unknownColorGames > total.gamesPlayed
    || result.uniqueDecks > total.gamesPlayed - total.unlinkedDeckGames || result.topDecks.length > Math.min(10,result.uniqueDecks)
    || new Set(result.topDecks.map(item => item.id)).size !== result.topDecks.length
    || result.streaks.current > result.streaks.longest || result.streaks.longest > total.wins
    || (!result.chronologyComplete && result.streaks.longest !== 0)) return invalid();
  const allCards = result.bestDeck ? [...result.topDecks,result.bestDeck] : result.topDecks;
  if (allCards.some(item => item.gamesPlayed > total.gamesPlayed || item.wins > total.wins || item.draws > total.draws)
    || result.topDecks.reduce((sum,item) => sum + item.gamesPlayed,0) > total.gamesPlayed - total.unlinkedDeckGames
    || (result.bestDeck !== null && result.bestDeck.gamesPlayed < 3)) return invalid();
  const sums = result.colors.reduce((sum,item) => ({ gamesPlayed: sum.gamesPlayed + item.gamesPlayed, wins: sum.wins + item.wins, draws: sum.draws + item.draws }),{ gamesPlayed: 0, wins: 0, draws: 0 });
  if (sums.gamesPlayed !== total.gamesPlayed || sums.wins !== total.wins || sums.draws !== total.draws
    || result.colors.filter(item => item.colors.length === 0).reduce((sum,item) => sum + item.gamesPlayed,0) !== total.unknownColorGames
    || new Set(result.colors.map(item => [...item.colors].sort().join(''))).size !== result.colors.length
    || new Set(result.bracketWins.map(item => item.bracket)).size !== result.bracketWins.length
    || new Set(result.winConditions.map(item => item.condition)).size !== result.winConditions.length
    || result.bracketWins.reduce((sum,item) => sum + item.wins,0) > total.wins
    || result.winConditions.reduce((sum,item) => sum + item.wins,0) > total.wins) return invalid();
  return result;
}

export function parseProfileDeckPerformance(value: unknown) {
  const row=object(value);
  if (row.schemaVersion !== 2 || row.complete !== true) return invalid();
  const decks=list(row.decks,entry => {
    const item=object(entry);
    const parsed={ deck_id: text(item.deck_id), games_played: count(item.games_played), wins: count(item.wins), draws: count(item.draws),
      mastery_points: count(item.mastery_points), tracked_games: count(item.tracked_games), second_places: count(item.second_places),
      damage_dealt: count(item.damage_dealt), damage_taken: count(item.damage_taken), life_gained: count(item.life_gained),
      commander_damage: count(item.commander_damage), infect_dealt: count(item.infect_dealt), eliminations: count(item.eliminations),
      median_winning_duration_seconds: item.median_winning_duration_seconds === null ? null : count(item.median_winning_duration_seconds) };
    if (!parsed.deck_id || parsed.wins + parsed.draws > parsed.games_played || parsed.tracked_games > parsed.games_played
      || parsed.second_places > parsed.games_played) return invalid();
    return parsed;
  });
  const total=count(row.total);
  if (total !== decks.length || new Set(decks.map(deck=>deck.deck_id)).size !== total) return invalid();
  return { schemaVersion: 2 as const, complete: true as const, asOf: timestamp(row.asOf), total, decks };
}
