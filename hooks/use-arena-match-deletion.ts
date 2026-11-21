'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { deleteArenaMatch } from '@/lib/arena-match-write';
import { useCommandScope, type CommandJob } from '@/hooks/use-command-scope';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';

type MatchIdentity = { id: string; group_id: string; created_by: string | null };
export function useArenaMatchDeletion(userId: string | null, groupId: string, adminMode: boolean,
  canManageGroup: boolean, matches: MatchIdentity[], refreshMatches: () => Promise<unknown>) {
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const key = userId && groupId ? JSON.stringify([userId, groupId, adminMode, canManageGroup]) : null;
  const { epoch, begin } = useCommandScope<'delete'>(key, true);
  const [current, setCurrent] = useState<{ id: string; job: CommandJob } | null>(null);
  const deletingMatch = current?.job.epoch === epoch && current.job.active();
  const handleDeleteMatch = async (matchId: string) => {
    const match = matches.find(row => row.id === matchId && row.group_id === groupId);
    if (!userId || !match || (!canManageGroup && !adminMode && match.created_by !== userId)) return;
    const job = begin('delete'); if (!job) return;
    try {
      if (!confirm(t({ it: 'Eliminare questa partita?', en: 'Are you sure you want to delete this battle record?' }))) return;
      job.signal.throwIfAborted();
      if (!job.active()) return;
      setCurrent({ id: matchId, job });
      await deleteArenaMatch(supabase, groupId, matchId, job.signal);
      if (!job.active()) return;
      toast({ title: t({ it: 'Partita eliminata', en: 'Battle deleted' }) });
      await Promise.allSettled([refreshMatches()]);
    } catch (error) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }), variant: 'destructive',
        description: error instanceof Error && error.message === 'Match was not deleted'
          ? t({ it: 'Partita non eliminata: verifica di essere proprietario dell’arena o creatore della partita.', en: 'Match not deleted: verify that you own the arena or created the match.' })
          : getSupabaseErrorMessage(error, t({ it: 'Impossibile eliminare la partita', en: 'Failed to delete match' })) });
    } finally {
      if (job.active()) setCurrent(previous => job.active() && previous?.job === job ? null : previous);
      job.finish();
    }
  };
  return { handleDeleteMatch, deletingMatch: Boolean(deletingMatch) };
}
