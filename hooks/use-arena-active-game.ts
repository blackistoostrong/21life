'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchActiveLiveGame } from '@/lib/live-game-service';
import { toUserParticipantKey } from '@/lib/participant-keys';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';

export function useArenaActiveGame(user: { id: string } | null, groupId: string) {
  const [activeLiveGameId, setActiveLiveGameId] = useState<string | null>(null);
  const refreshActiveLiveGame = useCallback(async () => {
    if (!groupId || !user) {
      setActiveLiveGameId(null);
      return;
    }
    try {
      const game = await fetchActiveLiveGame(supabase, groupId, toUserParticipantKey(user.id));
      setActiveLiveGameId(game?.id ?? null);
    } catch (error) {
      console.error('Error fetching active live game:', getSupabaseErrorMessage(error as Error, 'Failed to fetch active game'));
      setActiveLiveGameId(null);
    }
  }, [groupId, user]);
  useEffect(() => {
    if (!user) return;
    void refreshActiveLiveGame();
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshActiveLiveGame();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [groupId, refreshActiveLiveGame, user]);
  return activeLiveGameId;
}
