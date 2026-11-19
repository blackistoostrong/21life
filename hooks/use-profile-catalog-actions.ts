'use client';
import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';
import type { ProfileDeck as Deck } from '@/lib/types/profile-deck';

export function useProfileCatalogActions(user: User | null, setDecks: Dispatch<SetStateAction<Deck[]>>, fetchDecks: () => Promise<void>) {
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const setDeckArchived = useCallback(async (deck: Deck, archived: boolean) => {
    if (!user || deck.user_id !== user.id || deck.group_id !== null) return;
    const { error } = await supabase.from('decks').update({ is_archived: archived })
      .eq('id', deck.id).eq('user_id', user.id).is('group_id', null);
    if (error) throw error;
    setDecks((current) => current.map((entry) => entry.id === deck.id ? { ...entry, is_archived: archived } : entry));
    toast({ title: t(archived ? { it: 'Mazzo archiviato', en: 'Deck archived' } : { it: 'Mazzo ripristinato', en: 'Deck restored' }) });
  }, [setDecks, t, toast, user]);

  const toggleDeckFavorite = useCallback(async (deck: Deck) => {
    if (!user || deck.user_id !== user.id) return;
    const next = !deck.is_favorite;
    setDecks((current) => current.map((entry) => entry.id === deck.id ? { ...entry, is_favorite: next } : entry));
    const { error } = await supabase
      .from('decks')
      .update({ is_favorite: next })
      .eq('id', deck.id)
      .eq('user_id', user.id);
    if (error) {
      setDecks((current) => current.map((entry) => entry.id === deck.id ? { ...entry, is_favorite: !next } : entry));
      toast({
        title: t({ it: 'Preferito non aggiornato', en: 'Favorite not updated' }),
        variant: 'destructive',
      });
    }
  }, [setDecks, t, toast, user]);

  const handleDeleteDeck = async (deckId: string, deckName: string) => {
    if (!confirm(t({
      it: `Eliminare "${deckName}"?`,
      en: `Are you sure you want to delete "${deckName}"?`,
    }))) return;

    try {
      const { error } = await supabase.from('decks').delete().eq('id', deckId);
      if (error) throw error;

      toast({ title: t({ it: 'Mazzo eliminato', en: 'Deck deleted' }) });
      fetchDecks();
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Eliminazione mazzo non riuscita', en: 'Failed to delete deck' }),
        variant: 'destructive',
      });
    }
  };
  return { setDeckArchived, toggleDeckFavorite, handleDeleteDeck };
}
