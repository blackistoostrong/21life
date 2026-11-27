'use client';
import { useMemo, useState } from 'react';
import { getDeckDisplayColors } from '@/lib/deck-metadata';
import { getHighestMasteryDeck } from '@/lib/deck-mastery';
import { buildMatchRecord } from '@/lib/win-rate';
import type { ProfileDeck as Deck } from '@/lib/types/profile-deck';
import type { DeckPerformanceStats } from '@/lib/deck-performance-analytics';

/** Local collection controls and derived views; no network or duplicate catalog state. */
export function useProfileDeckCollection(decks: Deck[], adminMode: boolean,
  userId: string | undefined, deckPerformance: ReadonlyMap<string, DeckPerformanceStats>) {
  const [deckSearchQuery, setDeckSearchQuery] = useState('');

  const [deckColorFilter, setDeckColorFilter] = useState<string[]>([]);

  const [deckPlayerFilter, setDeckPlayerFilter] = useState('all');

  const [deckSort, setDeckSort] = useState<'recent' | 'winRate' | 'gamesPlayed' | 'damage' | 'eliminations' | 'fastest'>('recent');

  const visibleDecks = useMemo(() => {
    const activeDecks = decks.filter((deck) => !deck.is_archived);
    if (!adminMode || deckPlayerFilter === 'all') {
      return activeDecks;
    }

    return activeDecks.filter((deck) => deck.user_id === deckPlayerFilter);
  }, [adminMode, deckPlayerFilter, decks]);

  const archivedDecks = useMemo(() => decks.filter((deck) => deck.is_archived && deck.user_id === userId), [decks, userId]);

  const filteredDecks = useMemo(() => {
    const normalizedQuery = deckSearchQuery.trim().toLowerCase();

    const matching = visibleDecks.filter((deck) => {
      if (deckColorFilter.length) {
        const colors = getDeckDisplayColors(deck);
        if (!deckColorFilter.every((color) => colors.includes(color))) {
          return false;
        }
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = `${deck.name} ${deck.commander}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    return matching.sort((left, right) => {
      const favoriteOrder = Number(right.is_favorite) - Number(left.is_favorite);
      if (favoriteOrder !== 0) return favoriteOrder;
      const a = deckPerformance.get(left.id);
      const b = deckPerformance.get(right.id);
      if (deckSort === 'winRate') return (b?.winRate || 0) - (a?.winRate || 0) || (b?.gamesPlayed || 0) - (a?.gamesPlayed || 0);
      if (deckSort === 'gamesPlayed') return (b?.gamesPlayed || 0) - (a?.gamesPlayed || 0);
      if (deckSort === 'damage') return (b?.totalDamageDealt || 0) - (a?.totalDamageDealt || 0);
      if (deckSort === 'eliminations') return (b?.eliminations || 0) - (a?.eliminations || 0);
      if (deckSort === 'fastest') {
        return (a?.medianWinningDurationSeconds ?? Number.MAX_SAFE_INTEGER)
          - (b?.medianWinningDurationSeconds ?? Number.MAX_SAFE_INTEGER);
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
  }, [deckColorFilter, deckPerformance, deckSearchQuery, deckSort, visibleDecks]);

  const personalSnapshot = useMemo(() => {
    const performances = visibleDecks.map((deck) => deckPerformance.get(deck.id)).filter((entry): entry is DeckPerformanceStats => Boolean(entry));
    const games = performances.reduce((total, entry) => total + entry.gamesPlayed, 0);
    const wins = performances.reduce((total, entry) => total + entry.wins, 0);
    const favorite = getHighestMasteryDeck(visibleDecks, (deck) => deckPerformance.get(deck.id));
    const mostPlayed = [...visibleDecks].sort((a, b) => (deckPerformance.get(b.id)?.gamesPlayed || 0) - (deckPerformance.get(a.id)?.gamesPlayed || 0))[0];
    const draws=performances.reduce((total,entry)=>total+entry.draws,0);
    return { games, ...buildMatchRecord({gamesPlayed:games,wins,draws}), favorite, mostPlayed };
  }, [deckPerformance, visibleDecks]);
  return { deckSearchQuery, setDeckSearchQuery, deckColorFilter, setDeckColorFilter,
    deckPlayerFilter, setDeckPlayerFilter, deckSort, setDeckSort,
    visibleDecks, archivedDecks, filteredDecks, personalSnapshot };
}

export type ProfileDeckCollectionControls = ReturnType<typeof useProfileDeckCollection>;
