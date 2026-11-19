'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';
import { supabase } from '@/lib/supabase';
import { buildPairedCommanderColorFields, buildPairedCommanderName } from '@/lib/commander-partners';
import { normalizeGuestName, toGuestParticipantKey, type ParticipantKey } from '@/lib/participant-keys';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import type { ArenaGuest } from '@/lib/arena-participants';
import type { CommanderSearchResult } from '@/lib/scryfall';

type Inputs = {
  groupId: string; guests: ArenaGuest[]; canManageGroup: boolean;
  reloadGuests: () => Promise<unknown>; refreshMatches: () => Promise<unknown>;
  setSelectedParticipantKeys: Dispatch<SetStateAction<ParticipantKey[]>>;
  setParticipantDecks: Dispatch<SetStateAction<Record<string, string>>>;
  updateDeckColors: (action: (previous: Record<string, string[]>) => Record<string, string[]>) => void;
  winnerKey: ParticipantKey | ''; setWinnerKey: Dispatch<SetStateAction<ParticipantKey | ''>>;
  toggleParticipantSelection: (key: ParticipantKey) => void;
};

export function useArenaGuestCommands({ groupId, guests, canManageGroup, reloadGuests, refreshMatches,
  setSelectedParticipantKeys, setParticipantDecks, updateDeckColors, winnerKey, setWinnerKey, toggleParticipantSelection }: Inputs) {
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const [showGuestModal, setShowGuestModal] = useState(false);

  const [guestModalMode, setGuestModalMode] = useState<'pick-existing' | 'create' | 'manage-create' | 'add-deck'>('pick-existing');

  const [guestDeckTargetId, setGuestDeckTargetId] = useState<string | null>(null);

  const [guestName, setGuestName] = useState('');

  const [guestDeckName, setGuestDeckName] = useState('');

  const [guestSelectedCommander, setGuestSelectedCommander] = useState<CommanderSearchResult | null>(null);

  const [guestSelectedPartnerCommander, setGuestSelectedPartnerCommander] = useState<CommanderSearchResult | null>(null);

  const [savingGuest, setSavingGuest] = useState(false);

  const [deletingGuestIds, setDeletingGuestIds] = useState<string[]>([]);

  const resetGuestModal = () => {
    setShowGuestModal(false);
    setGuestName('');
    setGuestDeckName('');
    setGuestSelectedCommander(null);
    setGuestSelectedPartnerCommander(null);
    setGuestDeckTargetId(null);
    setGuestModalMode('pick-existing');
  };

  const addGuestDeck = async (
    guestId: string,
    commander: CommanderSearchResult,
    deckName?: string,
    partnerCommander?: CommanderSearchResult | null,
    options?: { addToMatch?: boolean },
  ) => {
    const commanderDisplayName = buildPairedCommanderName(commander, partnerCommander);
    const colorFields = buildPairedCommanderColorFields(commander, partnerCommander);

    const { data: createdDeck, error: deckError } = await supabase
      .from('arena_guest_decks')
      .insert({
        guest_id: guestId,
        group_id: groupId,
        name: deckName?.trim() || commanderDisplayName,
        commander: commanderDisplayName,
        commander_image: commander.imageUrl,
        ...colorFields,
        bracket: null,
      })
      .select('id, guest_id, group_id, name, commander, commander_image, color_identity, bracket, created_at')
      .single();

    if (deckError) throw deckError;

    await supabase
      .from('arena_guests')
      .update({ last_played_at: new Date().toISOString() })
      .eq('id', guestId);

    await reloadGuests();

    const participantKey = toGuestParticipantKey(guestId);
    if (options?.addToMatch !== false) {
      setSelectedParticipantKeys((prev) => prev.includes(participantKey) ? prev : [...prev, participantKey]);
      setParticipantDecks((prev) => ({ ...prev, [participantKey]: createdDeck.id }));
    }
    if (createdDeck.color_identity?.length) {
      updateDeckColors((prev) => ({ ...prev, [createdDeck.id]: createdDeck.color_identity }));
    }

    return createdDeck;
  };

  const upsertGuestWithDeck = async (
    displayName: string,
    commander: CommanderSearchResult,
    deckName?: string,
    partnerCommander?: CommanderSearchResult | null,
    options?: { addToMatch?: boolean },
  ) => {
    const normalized = normalizeGuestName(displayName);
    if (!normalized) throw new Error('Guest name is required');

    let guest = guests.find((entry) => normalizeGuestName(entry.display_name) === normalized) || null;

    if (!guest) {
      const { data: createdGuest, error: guestError } = await supabase
        .from('arena_guests')
        .insert({
          group_id: groupId,
          display_name: displayName.trim(),
          normalized_name: normalized,
        })
        .select('id, group_id, display_name, last_played_at')
        .single();

      if (guestError) throw guestError;
      guest = { ...createdGuest, arena_guest_decks: [] } as ArenaGuest;
    }

    const createdDeck = await addGuestDeck(guest.id, commander, deckName, partnerCommander, options);

    return {
      guestId: guest.id,
      deckId: createdDeck.id,
      participantKey: toGuestParticipantKey(guest.id),
    };
  };

  const openAddGuestDeckModal = (guest: ArenaGuest) => {
    setGuestDeckTargetId(guest.id);
    setGuestName(guest.display_name);
    setGuestDeckName('');
    setGuestSelectedCommander(null);
    setGuestSelectedPartnerCommander(null);
    setGuestModalMode('add-deck');
    setShowGuestModal(true);
  };

  const handleSaveGuestModal = async () => {
    if (guestModalMode === 'add-deck') {
      if (!guestDeckTargetId || !guestSelectedCommander) {
        toast({
          title: t({ it: 'Errore', en: 'Error' }),
          description: t({ it: 'Seleziona un comandante per il nuovo mazzo', en: 'Select a commander for the new deck' }),
          variant: 'destructive',
        });
        return;
      }

      setSavingGuest(true);
      try {
        await addGuestDeck(
          guestDeckTargetId,
          guestSelectedCommander,
          guestDeckName,
          guestSelectedPartnerCommander,
          { addToMatch: false },
        );
        resetGuestModal();
        toast({
          title: t({ it: 'Mazzo aggiunto', en: 'Deck added' }),
          description: t({ it: 'Il mazzo è stato aggiunto al guest', en: 'Deck added to guest' }),
        });
      } catch (error: unknown) {
        toast({
          title: t({ it: 'Errore', en: 'Error' }),
          description: getSupabaseErrorMessage(error, t({ it: 'Impossibile salvare il mazzo', en: 'Failed to save deck' })),
          variant: 'destructive',
        });
      } finally {
        setSavingGuest(false);
      }
      return;
    }

    if (!guestName.trim() || !guestSelectedCommander) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Inserisci nome guest e seleziona un comandante', en: 'Enter a guest name and select a commander' }),
        variant: 'destructive',
      });
      return;
    }

    setSavingGuest(true);
    try {
      await upsertGuestWithDeck(guestName, guestSelectedCommander, guestDeckName, guestSelectedPartnerCommander, {addToMatch:guestModalMode!=='manage-create'});
      resetGuestModal();
      toast({
        title: t({ it: 'Guest aggiunto', en: 'Guest added' }),
        description: guestModalMode==='manage-create' ? t({it:'Guest e mazzo aggiunti al playgroup',en:'Guest and deck added to playgroup'}) : t({ it: 'Il guest è stato aggiunto alla partita', en: 'Guest added to this battle' }),
      });
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile salvare il guest', en: 'Failed to save guest' })),
        variant: 'destructive',
      });
    } finally {
      setSavingGuest(false);
    }
  };

  const addExistingGuestToMatch = (guest: ArenaGuest) => {
    const participantKey = toGuestParticipantKey(guest.id);
    toggleParticipantSelection(participantKey);
    setShowGuestModal(false);
  };

  const handleDeleteGuest = async (guest: ArenaGuest) => {
    if (!canManageGroup) return;

    const deckCount = guest.arena_guest_decks?.length || 0;
    const confirmed = confirm(t({
      it: `Eliminare il guest "${guest.display_name}"? Verranno rimossi anche ${deckCount} ${deckCount === 1 ? 'mazzo' : 'mazzi'} e le sue presenze nelle partite registrate.`,
      en: `Delete guest "${guest.display_name}"? This also removes ${deckCount} ${deckCount === 1 ? 'deck' : 'decks'} and their entries from recorded battles.`,
    }));
    if (!confirmed) return;

    setDeletingGuestIds((ids) => [...ids, guest.id]);
    try {
      const { error } = await supabase
        .from('arena_guests')
        .delete()
        .eq('id', guest.id)
        .eq('group_id', groupId);

      if (error) throw error;

      const guestParticipantKey = toGuestParticipantKey(guest.id);
      setSelectedParticipantKeys((keys) => keys.filter((key) => key !== guestParticipantKey));
      setParticipantDecks((current) => {
        const next = { ...current };
        delete next[guestParticipantKey];
        return next;
      });
      if (winnerKey === guestParticipantKey) setWinnerKey('');

      await reloadGuests();
      refreshMatches();
      toast({
        title: t({ it: 'Guest eliminato', en: 'Guest deleted' }),
        description: guest.display_name,
      });
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile eliminare il guest', en: 'Failed to delete guest' })),
        variant: 'destructive',
      });
    } finally {
      setDeletingGuestIds((ids) => ids.filter((id) => id !== guest.id));
    }
  };
  return { showGuestModal, setShowGuestModal, guestModalMode, setGuestModalMode, guestDeckTargetId, setGuestDeckTargetId, guestName, setGuestName, guestDeckName, setGuestDeckName, guestSelectedCommander, setGuestSelectedCommander, guestSelectedPartnerCommander, setGuestSelectedPartnerCommander, savingGuest, deletingGuestIds, resetGuestModal, openAddGuestDeckModal, handleSaveGuestModal, addExistingGuestToMatch, handleDeleteGuest };
}
