'use client';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useCommandScope, type CommandJob } from '@/hooks/use-command-scope';
import { supabase } from '@/lib/supabase';
import { fetchActiveLiveGame } from '@/lib/live-game-service';
import { toUserParticipantKey } from '@/lib/participant-keys';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { withRequestDeadline } from '@/packages/data/request-deadline';

/** The actor/group lease owns active-game reads and visibility listeners. */
export function useArenaActiveGame(userId: string | null, groupId: string, adminMode: boolean) {
  const key = userId && groupId ? JSON.stringify([userId, groupId, adminMode]) : null;
  const { epoch, begin, cancel } = useCommandScope<'active'>(key, true);
  const [result, setResult] = useState<{ epoch: CommandJob['epoch']; id: string | null } | null>(null);
  useLayoutEffect(() => { setResult(previous => previous?.epoch === epoch ? previous : null); }, [epoch]);
  const refreshActiveLiveGame = useCallback(async () => {
    if (!userId || !groupId) return;
    const job = begin('active');
    if (!job) return;
    try {
      const game = await withRequestDeadline({ abortSignal: signal => fetchActiveLiveGame(supabase, groupId, toUserParticipantKey(userId), signal) }, 15000, job.signal);
      if (job.active()) setResult(previous => job.active() ? { epoch, id: game?.id ?? null } : previous);
    } catch (error) {
      if (job.active()) {
        console.error('Error fetching active live game:', getSupabaseErrorMessage(error as Error, 'Failed to fetch active game'));
        setResult(previous => job.active() ? { epoch, id: null } : previous);
      }
    } finally {
      job.finish();
    }
  }, [groupId, userId, begin, epoch]);
  useEffect(() => {
    if (!userId || !groupId) return;
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
      cancel('active');
    };
  }, [groupId, refreshActiveLiveGame, userId, cancel]);
  return result?.epoch === epoch ? result.id : null;
}
