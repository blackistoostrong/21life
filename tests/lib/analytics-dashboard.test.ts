import { describe, expect, it } from 'vitest';
import { buildAnalyticsDashboard } from '@/packages/domain/analytics-dashboard';
import { parseAnalyticsDashboard, parseProfileDeckPerformance } from '@/packages/domain/analytics-dashboard-contract';
import { analyticsDashboardFixture } from '../fixtures/analytics-dashboard';

describe('complete analytics aggregates', () => {
  it('preserves one win one loss one draw and weighted color appearances', () => {
    const source = analyticsDashboardFixture();
    const result = buildAnalyticsDashboard(parseAnalyticsDashboard(source));
    expect(result).toMatchObject({ gamesPlayed: 3, wins: 1, losses: 1, draws: 1, decisiveGames: 2, winRate: 50, uniqueDecks: 1 });
    expect(result.topDecks[0]).toMatchObject({ winRate: 50, decisiveGames: 2 });
    expect(result.colorStats.map(value => value.percentage)).toEqual([50,50]);
    expect(result.colorWinStats.every(value => value.winRate === 50 && value.gamesPlayed === 3)).toBe(true);
    expect(result.winConditions).toEqual([{ condition: 'combo', wins: 1, percentage: 100 }]);
    expect(result.sample).toMatchObject({ schemaVersion: 2, complete: true, matches: 3, scope: 'personal' });
    expect(source).toEqual(analyticsDashboardFixture());
  });
  it('retains complete empty datasets without inventing a best deck or color percentages', () => {
    const source = analyticsDashboardFixture();
    Object.assign(source,{ totals: { gamesPlayed: 0, wins: 0, draws: 0, matches: 0, unlinkedDeckGames: 0, unknownColorGames: 0 },
      uniqueDecks: 0, topDecks: [], bestDeck: null, colors: [], bracketWins: [], winConditions: [], streaks: { longest: 0, current: 0 } });
    expect(buildAnalyticsDashboard(parseAnalyticsDashboard(source))).toMatchObject({ gamesPlayed: 0, decisiveGames: 0, winRate: 0,
      bestDeck: null, topDecks: [], colorStats: [], colorWinStats: [], winConditions: [], sample: { complete: true } });
  });
  it('keeps unlinked legacy games and unknown colors inside totals, outside invented deck identities', () => {
    const source = analyticsDashboardFixture();
    source.totals.unlinkedDeckGames=3; source.totals.unknownColorGames=3;
    source.uniqueDecks=0; source.topDecks=[]; source.bestDeck=null; source.colors=[{ colors: [], gamesPlayed: 3, wins: 1, draws: 1 }];
    const result=buildAnalyticsDashboard(parseAnalyticsDashboard(source));
    expect(result.gamesPlayed).toBe(3); expect(result.uniqueDecks).toBe(0); expect(result.colorStats).toEqual([]);
    expect(result.sample).toMatchObject({ unlinkedDeckGames: 3, unknownColorGames: 3 });
  });
  it('retains the internal draw-neutral convention for all-draw samples', () => {
    const source=analyticsDashboardFixture();
    Object.assign(source.totals,{ wins: 0, draws: 3 });
    for (const row of [...source.topDecks,source.bestDeck!,...source.colors]) Object.assign(row,{ wins: 0, draws: 3 });
    source.streaks={ longest: 0, current: 0 }; source.bracketWins=[]; source.winConditions=[];
    expect(buildAnalyticsDashboard(parseAnalyticsDashboard(source))).toMatchObject({ decisiveGames: 0, losses: 0, winRate: 0, draws: 3 });
  });
  it('sorts weighted summaries deterministically and preserves historical card metadata', () => {
    const source=analyticsDashboardFixture();
    source.totals={ gamesPlayed: 6, wins: 3, draws: 1, matches: 6, unlinkedDeckGames: 0, unknownColorGames: 0 };
    source.uniqueDecks=2;
    source.topDecks[0].historical=true;
    source.topDecks.push({ ...source.topDecks[0], id: 'second', gamesPlayed: 3, wins: 2, draws: 0, colors: ['C'] });
    source.colors.push({ gamesPlayed: 3, wins: 2, draws: 0, colors: ['C'] });
    source.bracketWins=[{ bracket: '10', wins: 1 },{ bracket: '2', wins: 1 }];
    source.winConditions=[{ condition: 'other', wins: 1 },{ condition: 'combo', wins: 1 }];
    const result=buildAnalyticsDashboard(parseAnalyticsDashboard(source));
    expect(result.bracketWins.map(value=>value.bracket)).toEqual(['2','10']);
    expect(result.winConditions.map(value=>value.condition)).toEqual(['combo','other']);
    expect(result.colorWinStats[0].color).toBe('C'); expect(result.topDecks[0].historical).toBe(true);
  });
});

describe('strict aggregate response boundary', () => {
  const base=analyticsDashboardFixture();
  const bad: Array<[string,unknown]> = [
    ['null',null], ['array',[]], ['wrong version',{ ...base, schemaVersion: 1 }], ['partial',{ ...base, complete: false }],
    ['missing complete',{ ...base, complete: undefined }], ['wrong scope',{ ...base, scope: 'everyone' }],
    ['invalid snapshot',{ ...base, asOf: 'yesterday' }], ['missing period',{ ...base, period: {} }],
    ['reversed period',{ ...base, period: { since: '2026-02-01T00:00:00Z', until: '2026-01-01T00:00:00Z', bracket: null } }],
    ['string count',{ ...base, totals: { ...base.totals, wins: '1' } }],
    ['nonfinite',{ ...base, totals: { ...base.totals, gamesPlayed: Infinity } }],
    ['negative',{ ...base, totals: { ...base.totals, draws: -1 } }], ['fractional',{ ...base, totals: { ...base.totals, wins: 0.5 } }],
    ['inconsistent outcomes',{ ...base, totals: { ...base.totals, wins: 3 } }],
    ['invented deck count',{ ...base, uniqueDecks: 4 }], ['too many matches',{ ...base, totals: { ...base.totals, matches: 4 } }],
    ['too many unlinked',{ ...base, totals: { ...base.totals, unlinkedDeckGames: 4 } }],
    ['too many unknown colors',{ ...base, totals: { ...base.totals, unknownColorGames: 4 } }],
    ['duplicate cards',{ ...base, topDecks: [base.topDecks[0],base.topDecks[0]] }],
    ['missing cards',{ ...base, topDecks: undefined }], ['empty card identity',{ ...base, topDecks: [{ ...base.topDecks[0], id: '' }] }],
    ['unknown color',{ ...base, colors: [{ ...base.colors[0], colors: ['X'] }] }],
    ['duplicate colors',{ ...base, colors: [{ ...base.colors[0], colors: ['W','W'] }] }],
    ['colorless plus color',{ ...base, colors: [{ ...base.colors[0], colors: ['C','W'] }] }],
    ['missing color group',{ ...base, colors: [] }], ['missing unknown coverage',{ ...base, totals: { ...base.totals, unknownColorGames: 1 } }],
    ['current exceeds longest',{ ...base, streaks: { longest: 1, current: 2 } }],
    ['streak exceeds wins',{ ...base, streaks: { longest: 2, current: 0 } }],
    ['unknown chronology with streak',{ ...base, chronologyComplete: false }],
    ['duplicated bracket',{ ...base, bracketWins: [base.bracketWins[0],base.bracketWins[0]] }],
    ['duplicated condition',{ ...base, winConditions: [base.winConditions[0],base.winConditions[0]] }],
    ['unaccounted wins',{ ...base, winConditions: [{ condition: 'combo', wins: 2 }] }],
  ];
  it.each(bad)('rejects %s with a sanitized contract error', (_name,value) => {
    expect(()=>parseAnalyticsDashboard(value)).toThrow('ANALYTICS_CONTRACT_INVALID');
  });
});

describe('complete profile performance envelope', () => {
  const deck={ deck_id: 'deck', games_played: 3, wins: 1, draws: 1, mastery_points: 5, tracked_games: 2, second_places: 1,
    damage_dealt: 50, damage_taken: 40, life_gained: 2, commander_damage: 5, infect_dealt: 0, eliminations: 1, median_winning_duration_seconds: 3600 };
  const envelope={ schemaVersion: 2, complete: true, asOf: '2026-11-16T00:00:00Z', total: 1, decks: [deck] };
  it('retains all1006 rows above the Data API table cap', () => {
    const rows=Array.from({ length: 1006 },(_,index)=>({ ...deck, deck_id: `deck-${index}`, median_winning_duration_seconds: null }));
    expect(parseProfileDeckPerformance({ ...envelope, total: 1006, decks: rows }).decks).toHaveLength(1006);
    expect(parseProfileDeckPerformance({ ...envelope, total: 0, decks: [] }).total).toBe(0);
  });
  it.each([
    { ...envelope, schemaVersion: 1 }, { ...envelope, complete: false }, { ...envelope, total: 2 },
    { ...envelope, total: 2, decks: [deck,deck] },
    { ...envelope, decks: [{ ...deck, wins: 3 }] }, { ...envelope, decks: [{ ...deck, tracked_games: 4 }] },
    { ...envelope, decks: [{ ...deck, second_places: 4 }] }, { ...envelope, decks: [{ ...deck, damage_dealt: '50' }] },
    { ...envelope, decks: [{ ...deck, median_winning_duration_seconds: undefined }] },
  ])('rejects incomplete/incoherent profile data', value=>{
    expect(()=>parseProfileDeckPerformance(value)).toThrow('ANALYTICS_CONTRACT_INVALID');
  });
});
