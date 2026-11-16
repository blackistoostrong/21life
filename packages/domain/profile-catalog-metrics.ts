import { parseProfileDeckPerformance } from './analytics-dashboard-contract';
import { buildMatchRecord } from './win-rate';

const extraFields = ['group_damage_dealt','group_damage_events','first_eliminations','comeback_wins','combo_wins','alternate_wins'] as const;
type ExtraMetrics = Record<typeof extraFields[number],number>;
export function parseProfileCatalogMetrics(value: unknown) {
  const base = parseProfileDeckPerformance(value);
  const raw = value as Record<string,unknown>;
  if (raw.metricFieldsVersion !== 1 || !['personal','global'].includes(String(raw.scope))
    || (raw.scope === 'global' ? raw.userId !== null : typeof raw.userId !== 'string' || !raw.userId)) throw new Error('ANALYTICS_CONTRACT_INVALID');
  const rawDecks = raw.decks as Record<string,unknown>[];
  const decks = base.decks.map((deck,index) => {
    const extra = Object.fromEntries(extraFields.map(field => {
      const count = rawDecks[index][field];
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('ANALYTICS_CONTRACT_INVALID');
      return [field,count];
    })) as ExtraMetrics;
    if (extra.first_eliminations > deck.games_played || extra.comeback_wins > deck.wins
      || extra.combo_wins + extra.alternate_wins > deck.wins
      || deck.mastery_points !== deck.games_played + 2 * deck.wins) throw new Error('ANALYTICS_CONTRACT_INVALID');
    return { ...deck,...extra };
  });
  return { ...base,scope: raw.scope as 'personal' | 'global',userId: raw.userId as string | null,metricFieldsVersion: 1 as const,decks };
}

export type ProfileCatalogMetrics = ReturnType<typeof parseProfileCatalogMetrics>;
/** Shared count math; platform adapters only rename fields or attach catalog labels. */
export function buildProfileCatalogMetric(row: ProfileCatalogMetrics['decks'][number]) {
  return { ...buildMatchRecord({ gamesPlayed: row.games_played,wins: row.wins,draws: row.draws }),
    masteryPoints: row.mastery_points,trackedGames: row.tracked_games,
    trackingCoverage: row.games_played ? Math.round(100 * row.tracked_games / row.games_played) : 0,
    averageDamageDealt: row.tracked_games ? Math.round(row.damage_dealt / row.tracked_games) : 0,
    secondPlaces: row.second_places,totalDamageDealt: row.damage_dealt,totalDamageTaken: row.damage_taken,
    totalLifeGained: row.life_gained,commanderDamageDealt: row.commander_damage,infectDealt: row.infect_dealt,
    eliminations: row.eliminations,groupDamageDealt: row.group_damage_dealt,groupDamageEvents: row.group_damage_events,
    firstEliminations: row.first_eliminations,comebackWins: row.comeback_wins,comboWins: row.combo_wins,
    alternateWins: row.alternate_wins,medianWinningDurationSeconds: row.median_winning_duration_seconds };
}
