'use client';
import { useCallback, useMemo, useState } from 'react';
import { isAfter, subDays } from 'date-fns';
import { useArenaAnalytics } from '@/hooks/use-arena-analytics';
import type { useArenaSeasonContext } from '@/hooks/use-arena-season-context';
import type { ArenaSeasonContext } from '@/lib/arena-seasons';
import { buildArenaAnalyticsBundle } from '@/lib/arena-analytics-bundle';
import { countProvisionalDeckRankings, filterDeckRankings } from '@/lib/deck-ranking-visibility';
import { buildArenaAwards, type ArenaAward as DeckArenaAward, type DeckPerformanceStats } from '@/lib/deck-performance-analytics';
import { buildPlayerAwardsFromAggregates } from '@/lib/player-awards';
import type { PlayerStats } from '@/lib/types/arena-player-report';

function getPlayerRank(stats: PlayerStats[], index: number) {
  const entry = stats[index];
  if (!entry) return index + 1;

  for (let i = 0; i < index; i++) {
    const previous = stats[i];
    if (
      previous.winRate === entry.winRate &&
      previous.wins === entry.wins &&
      previous.gamesPlayed === entry.gamesPlayed
    ) {
      return getPlayerRank(stats, i);
    }
  }

  return index + 1;
}

function hasSameCommanderRank(
  a: DeckPerformanceStats,
  b: DeckPerformanceStats,
  deckStatsSort: 'winRate' | 'gamesPlayed'
) {
  if (deckStatsSort === 'gamesPlayed') {
    return a.gamesPlayed === b.gamesPlayed && a.wins === b.wins && a.winRate === b.winRate;
  }
  return a.winRate === b.winRate && a.wins === b.wins && a.gamesPlayed === b.gamesPlayed;
}

function getCommanderRank(
  stats: DeckPerformanceStats[],
  index: number,
  deckStatsSort: 'winRate' | 'gamesPlayed'
) {
  const entry = stats[index];
  if (!entry) return index + 1;

  for (let i = 0; i < index; i++) {
    if (hasSameCommanderRank(stats[i], entry, deckStatsSort)) {
      return getCommanderRank(stats, i, deckStatsSort);
    }
  }

  return index + 1;
}

/** One shared period/bracket owns both report and history scope. */
export function useArenaReportScope(season: Pick<ReturnType<typeof useArenaSeasonContext>, 'data' | 'ready'>) {
  const seasonContext = season.data;
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '30d' | '90d'>('all');
  const [bracketFilter, setBracketFilter] = useState('all');
  const getStatsSinceDate = useCallback(() => {
    if(!season.ready)return null;
    const seasonStart = seasonContext
      ? new Date(`${seasonContext.currentSeasonStart}T00:00:00Z`)
      : null;
    if (dateFilter === 'all') return seasonStart;
    const now = new Date();
    const relativeStart = dateFilter === '7d'
      ? subDays(now, 7)
      : dateFilter === '30d'
        ? subDays(now, 30)
        : subDays(now, 90);
    return seasonStart && isAfter(seasonStart, relativeStart) ? seasonStart : relativeStart;
  }, [dateFilter, seasonContext, season.ready]);
  const reportSince=useMemo(()=>getStatsSinceDate()?.toISOString()??null,[getStatsSinceDate]);
  return { dateFilter, setDateFilter, bracketFilter, setBracketFilter, reportSince };
}

/** Report state and projections retain the page lifetime, independently of tab content. */
export function useArenaReports(userId: string | null, groupId: string, reportSince: string | null,
  seasonContext: ArenaSeasonContext | null, seasonReady: boolean, bracketFilter: string) {
  const season = { ready: seasonReady };
  const [awardsView, setAwardsView] = useState<'players' | 'decks'>('decks');
  const [deckStatsSort, setDeckStatsSort] = useState<'winRate' | 'gamesPlayed'>('winRate');
  const [showProvisionalDecks, setShowProvisionalDecks] = useState(false);
  const reportAnalytics=useArenaAnalytics(season.ready?userId ?? undefined:undefined,groupId,reportSince,
    seasonContext ? new Date(seasonContext.currentSeasonStart+'T00:00:00Z').toISOString():null,bracketFilter);
  const analyticsPayload=reportAnalytics.current;
  const allTimeAwardsPayload=reportAnalytics.awards;
  const analyticsBundle = useMemo(
    () => buildArenaAnalyticsBundle(analyticsPayload, bracketFilter, deckStatsSort),
    [analyticsPayload, bracketFilter, deckStatsSort],
  );
  const playerStats = analyticsBundle.players as PlayerStats[];
  const deckStats = analyticsBundle.decks;
  const visibleDeckStats = useMemo(
    () => filterDeckRankings(deckStats, showProvisionalDecks),
    [deckStats, showProvisionalDecks],
  );
  const provisionalDeckCount = countProvisionalDeckRankings(deckStats);
  const playerRanksByIndex = useMemo(
    () => playerStats.map((_, index) => getPlayerRank(playerStats, index)),
    [playerStats]
  );
  const commanderRanksByIndex = useMemo(
    () => visibleDeckStats.map((_, index) => getCommanderRank(visibleDeckStats, index, deckStatsSort)),
    [visibleDeckStats, deckStatsSort]
  );
  const colorAnalytics = analyticsBundle.colors;
  const deckPerformance = analyticsBundle.decks;
  const allTimeAwardsDeckPerformance = useMemo(
    () => buildArenaAnalyticsBundle(allTimeAwardsPayload, 'all', 'winRate').decks,
    [allTimeAwardsPayload],
  );
  const arenaAwards = useMemo(
    () => buildArenaAwards(allTimeAwardsDeckPerformance),
    [allTimeAwardsDeckPerformance],
  );
  const playerAwards = useMemo(() => buildPlayerAwardsFromAggregates(allTimeAwardsPayload.players??[]), [allTimeAwardsPayload.players]);
  const arenaAwardGroups = useMemo(() => {
    const groups = new Map<DeckArenaAward['kind'], DeckArenaAward[]>();
    arenaAwards.forEach((award) => {
      const entries = groups.get(award.kind) ?? [];
      entries.push(award);
      groups.set(award.kind, entries);
    });
    return Array.from(groups.values());
  }, [arenaAwards]);
  return {
    awardsView,
    setAwardsView,
    deckStatsSort,
    setDeckStatsSort,
    showProvisionalDecks,
    setShowProvisionalDecks,
    reportAnalytics,
    analyticsPayload,
    playerStats,
    deckStats,
    visibleDeckStats,
    provisionalDeckCount,
    playerRanksByIndex,
    commanderRanksByIndex,
    colorAnalytics,
    arenaAwards,
    playerAwards,
    arenaAwardGroups,
  };
}
