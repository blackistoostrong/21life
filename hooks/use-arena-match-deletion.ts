'use client';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';
export function useArenaMatchDeletion(refreshMatches:()=>Promise<unknown>) {
  const { toast }=useToast();
  const { copy:t }=useLanguage();
  const handleDeleteMatch = async (matchId: string) => {
    if (!confirm(t({ it: 'Eliminare questa partita?', en: 'Are you sure you want to delete this battle record?' }))) return;
    try {
      const { error: participantsError } = await supabase.from('match_participants').delete().eq('match_id', matchId);
      if (participantsError) throw participantsError;
      const { data: deletedMatch, error: matchError } = await supabase.from('matches').delete().eq('id', matchId).select('id').maybeSingle();
      if (matchError) throw matchError;
      if (!deletedMatch) throw new Error(t({ it: 'Partita non eliminata: verifica di essere proprietario dell’arena o creatore della partita.', en: 'Match not deleted: verify that you own the arena or created the match.' }));
      const { data: remaining, error: verifyError } = await supabase
        .from('matches')
        .select('id')
        .eq('id', matchId)
        .maybeSingle();
      if (verifyError) throw verifyError;
      if (remaining) throw new Error(t({ it: 'La partita non è stata eliminata.', en: 'The match was not deleted.' }));
      toast({ title: t({ it: 'Partita eliminata', en: 'Battle deleted' }) });
      await refreshMatches();
    } catch (error: unknown) {
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: error instanceof Error ? error.message : t({ it: 'Impossibile eliminare la partita', en: 'Failed to delete match' }), variant: 'destructive' });
    }
  };
  return { handleDeleteMatch };
}
