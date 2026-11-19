'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '@/lib/supabase';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { useProfileCommandScope, type ProfileCommandJob } from '@/hooks/use-profile-command-scope';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import type { ProfileDeck as Deck } from '@/lib/types/profile-deck';

export function useProfileCatalogActions(key: string | null, userId: string | null,
  setDecks: Dispatch<SetStateAction<Deck[]>>, fetchDecks: () => Promise<void>) {
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const { epoch, begin } = useProfileCommandScope(key, true);
  const [currentJob, setCurrentJob] = useState<ProfileCommandJob | null>(null);
  const catalogCommandsBusy = currentJob?.epoch === epoch && currentJob.active();
  const assertActive = (job: ProfileCommandJob) => {
    job.signal.throwIfAborted();
    if (!job.active()) throw new DOMException('Operation aborted', 'AbortError');
  };
  const run = async (task: (job: ProfileCommandJob) => Promise<void>, onError: (error: unknown, job: ProfileCommandJob) => void) => {
    const job = begin('save');
    if (!job) return;
    setCurrentJob(job);
    try { await task(job); }
    catch (error) { if (job.active()) onError(error, job); }
    finally {
      if (job.active()) setCurrentJob(previous => job.active() && previous === job ? null : previous);
      job.finish();
    }
  };
  const setDeckArchived = async (deck: Deck, archived: boolean) => {
    if (!userId || deck.user_id !== userId || deck.group_id !== null) return;
    const id = deck.id;
    await run(async job => {
      const { error } = await withRequestDeadline({ abortSignal: signal => {
        assertActive(job);
        return supabase.from('decks').update({ is_archived: archived })
          .eq('id', id).eq('user_id', userId).is('group_id', null).abortSignal(signal);
      } }, 15000, job.signal);
      if (error) throw error;
      assertActive(job);
      setDecks(previous => job.active() ? previous.map(entry => entry.id === id ? { ...entry, is_archived: archived } : entry) : previous);
      toast({ title: t(archived ? { it: 'Mazzo archiviato', en: 'Deck archived' } : { it: 'Mazzo ripristinato', en: 'Deck restored' }) });
    }, error => toast({ title: t({ it: 'Errore', en: 'Error' }), description: getSupabaseErrorMessage(error,
      t({ it: 'Archiviazione non riuscita', en: 'Failed to archive deck' })), variant: 'destructive' }));
  };
  const toggleDeckFavorite = async (deck: Deck) => {
    if (!userId || deck.user_id !== userId) return;
    const { id, is_favorite: before, updated_at: stamp } = deck;
    const next = !before;
    await run(async job => {
      setDecks(previous => job.active() ? previous.map(entry => entry.id === id ? { ...entry, is_favorite: next } : entry) : previous);
      const { error } = await withRequestDeadline({ abortSignal: signal => {
        assertActive(job);
        return supabase.from('decks').update({ is_favorite: next }).eq('id', id).eq('user_id', userId).abortSignal(signal);
      } }, 15000, job.signal);
      if (error) throw error;
      assertActive(job);
    }, (_error, job) => {
      setDecks(previous => job.active() ? previous.map(entry => entry.id === id && entry.is_favorite === next && entry.updated_at === stamp
        ? { ...entry, is_favorite: before } : entry) : previous);
      toast({ title: t({ it: 'Preferito non aggiornato', en: 'Favorite not updated' }), variant: 'destructive' });
    });
  };
  const handleDeleteDeck = async (id: string, name: string) => {
    await run(async job => {
      if (!confirm(t({ it: `Eliminare "${name}"?`, en: `Are you sure you want to delete "${name}"?` }))) return;
      assertActive(job);
      const { error } = await withRequestDeadline({ abortSignal: signal => {
        assertActive(job);
        return supabase.from('decks').delete().eq('id', id).abortSignal(signal);
      } }, 15000, job.signal);
      if (error) throw error;
      assertActive(job);
      toast({ title: t({ it: 'Mazzo eliminato', en: 'Deck deleted' }) });
      await fetchDecks();
    }, error => toast({ title: t({ it: 'Errore', en: 'Error' }), description: error instanceof Error ? error.message
      : t({ it: 'Eliminazione mazzo non riuscita', en: 'Failed to delete deck' }), variant: 'destructive' }));
  };
  return { catalogCommandsBusy, setDeckArchived, toggleDeckFavorite, handleDeleteDeck };
}
