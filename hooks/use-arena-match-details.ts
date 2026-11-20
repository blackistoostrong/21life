'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchLiveGameByMatchId } from '@/lib/live-game-service';
import type { LiveGameRecord } from '@/lib/live-game';
import type { Match } from '@/lib/types/arena-match';

export function useArenaMatchDetails() {
  const [detailsMatch, setDetailsMatch] = useState<Match | null>(null);
  const [detailsLiveGame, setDetailsLiveGame] = useState<LiveGameRecord | null>(null);
  const [detailsRecapLoading, setDetailsRecapLoading] = useState(false);
  useEffect(() => {
    if (!detailsMatch?.id || detailsMatch.tracking_version == null) {
      setDetailsLiveGame(null);
      setDetailsRecapLoading(false);
      return;
    }
    if (detailsMatch.tracking_version >= 3) {
      setDetailsLiveGame(null);
      setDetailsRecapLoading(false);
      return;
    }
    let active = true;
    setDetailsRecapLoading(true);
    void fetchLiveGameByMatchId(supabase, detailsMatch.id)
      .then((game) => { if (active) setDetailsLiveGame(game); })
      .catch(() => { if (active) setDetailsLiveGame(null); })
      .finally(() => { if (active) setDetailsRecapLoading(false); });
    return () => { active = false; };
  }, [detailsMatch?.id, detailsMatch?.tracking_version]);
  return { detailsMatch, setDetailsMatch, detailsLiveGame, detailsRecapLoading };
}
