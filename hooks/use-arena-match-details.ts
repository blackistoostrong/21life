'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCommandScope, type CommandJob } from '@/hooks/use-command-scope';
import { supabase } from '@/lib/supabase';
import { fetchLiveGameByMatchId } from '@/lib/live-game-service';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import type { LiveGameRecord } from '@/lib/live-game';
import type { Match } from '@/lib/types/arena-match';

type Draft = { epoch: CommandJob['epoch']; opening: number; match: Match };
type Recap = { epoch: CommandJob['epoch']; opening: number; game: LiveGameRecord | null };

/** A private opening owns its historical snapshot and optional legacy lookup. */
export function useArenaMatchDetails(userId: string | null, groupId: string, adminMode: boolean) {
  const key = userId && groupId ? JSON.stringify([userId, groupId, adminMode]) : null;
  const { epoch, begin, cancel, committed } = useCommandScope<'recap'>(key, true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const opening = useRef(0);
  const current = draft?.epoch === epoch ? draft : null;
  const detailsMatch = current?.match ?? null;
  const needsLookup = detailsMatch?.tracking_version != null && detailsMatch.tracking_version < 3;
  const loaded = recap?.epoch === epoch && recap.opening === current?.opening;

  useLayoutEffect(() => {
    setDraft(previous => previous?.epoch === epoch ? previous : null);
    setRecap(previous => previous?.epoch === epoch ? previous : null);
  }, [epoch]);

  const setDetailsMatch = (match: Match | null) => {
    if (!committed() || (match && match.group_id !== groupId)) return;
    cancel('recap');
    const next = match ? { epoch, opening: ++opening.current, match } : null;
    setDraft(previous => committed() ? next : previous);
  };

  useEffect(() => {
    if (!current || !needsLookup) return;
    const job = begin('recap', true);
    if (!job) return;
    void withRequestDeadline({ abortSignal: signal => fetchLiveGameByMatchId(supabase, current.match.id, { groupId, signal }) }, 15000, job.signal)
      .then(game => {
        if (job.active()) setRecap(previous => job.active() ? { epoch, opening: current.opening, game } : previous);
      })
      .catch(() => {
        // Preserve the existing historical snapshot fallback on legacy failure.
        if (job.active()) setRecap(previous => job.active() ? { epoch, opening: current.opening, game: null } : previous);
      })
      .finally(() => job.finish());
    return () => cancel('recap');
  }, [current, needsLookup, begin, cancel, epoch, groupId]);

  return { detailsMatch, setDetailsMatch, detailsLiveGame: needsLookup && loaded ? recap.game : null,
    detailsRecapLoading: Boolean(needsLookup && !loaded) };
}
