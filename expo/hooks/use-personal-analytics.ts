import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPersonalAnalyticsDashboard } from '@/lib/analytics-dashboard-query';
import { prefetchCommanderNames, prefetchDeckImageUrls } from '@/lib/deck-image-cache';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { supabase } from '@/lib/supabase';

export function usePersonalAnalytics(userId: string | undefined) {
  const analyticsQuery = useQuery({
    queryKey: ['personal-analytics', userId, 'v2'],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const analyticsResult = await fetchPersonalAnalyticsDashboard(supabase,userId!,{},signal);
      void prefetchDeckImageUrls([
        ...analyticsResult.topDecks.map((deck) => deck.commanderImage),
        analyticsResult.bestDeck?.commanderImage,
      ], { background: true });
      void prefetchCommanderNames([
        ...analyticsResult.topDecks.map((deck) => deck.commander),
        analyticsResult.bestDeck?.commander,
      ], { background: true });
      return analyticsResult;
    },
  });

  useEffect(() => {
    if (analyticsQuery.error) {
      console.error(
        'Error fetching personal analytics:',
        getSupabaseErrorMessage(analyticsQuery.error, 'Failed to fetch personal analytics'),
      );
    }
  }, [analyticsQuery.error]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    await analyticsQuery.refetch();
  }, [analyticsQuery, userId]);

  return {
    analytics: userId && !analyticsQuery.isError ? analyticsQuery.data ?? null : null,
    loading: Boolean(userId) && analyticsQuery.isPending,
    error: analyticsQuery.isError,
    refresh,
  };
}
