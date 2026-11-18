'use client';

import { useState, type SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { getCommanderOptions, filterSelectableCommanderOptions, resolveSelectedCommanderOption, mergeDeckColorFields } from '@/lib/deck-metadata';
import { isImportedDeckSource } from '@/lib/deck-importers';
import { uniqueCommanderOptions } from '@/lib/profile-commander';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { resolveDeckCommanderCmc } from '@/lib/deck-commander-cmc';
import type { CommanderArtOption, ImportedCommanderOption } from '@/lib/profile-commander';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

/** Owns commander presentation editing; catalog updates remain scoped by its caller. */
export function useProfileCommanderEditor(fetchCommanderArts: (name: string) => Promise<CommanderArtOption[]>,
  setDecks: (action: SetStateAction<Deck[]>) => void) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const [editingArtDeck, setEditingArtDeck] = useState<Deck | null>(null);

  const [deckCommanderOptions, setDeckCommanderOptions] = useState<ImportedCommanderOption[]>([]);

  const [selectedDeckCommander, setSelectedDeckCommander] = useState<ImportedCommanderOption | null>(null);

  const [deckArtOptions, setDeckArtOptions] = useState<CommanderArtOption[]>([]);

  const [loadingDeckArtOptions, setLoadingDeckArtOptions] = useState(false);

  const [savingDeckArt, setSavingDeckArt] = useState(false);

  const loadDeckCommanderArts = async (commanderName: string, fallbackImageUrl: string | null) => {
    setDeckArtOptions([]);
    setLoadingDeckArtOptions(true);
    try {
      const arts = await fetchCommanderArts(commanderName);
      const currentArt = fallbackImageUrl
        ? [{
            id: 'current',
            name: commanderName,
            imageUrl: fallbackImageUrl,
            setName: t({ it: 'Art corrente', en: 'Current art' }),
            collectorNumber: '',
            releasedAt: null,
          }]
        : [];
      const uniqueArts = [...currentArt, ...arts].filter((art, index, allArts) =>
        allArts.findIndex((candidate) => candidate.imageUrl === art.imageUrl) === index
      );
      setDeckArtOptions(uniqueArts);
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Impossibile caricare le art', en: 'Failed to load arts' }),
        variant: 'destructive',
      });
    } finally {
      setLoadingDeckArtOptions(false);
    }
  };

  const openDeckArtEditor = async (deck: Deck) => {
    const currentCommander = { name: deck.commander, imageUrl: deck.commander_image };
    setEditingArtDeck(deck);

    let loadedOptions = [currentCommander];
    const storedOptions = getCommanderOptions(deck);
    if (storedOptions.length > 0) {
      loadedOptions = uniqueCommanderOptions([currentCommander, ...storedOptions]);
    } else if (isImportedDeckSource(deck.source_type) && deck.source_url) {
      try {
        const response = await authenticatedFetch('/api/deck-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: deck.source_url }),
        });

        if (response.ok) {
          const imported = await response.json() as ImportedDeckPreview;
          const importedOptions = imported.commanderOptions || [];
          if (importedOptions.length > 0) {
            loadedOptions = uniqueCommanderOptions([currentCommander, ...importedOptions]);
          }
        }
      } catch {
        loadedOptions = [currentCommander];
      }
    }

    const selectableOptions = filterSelectableCommanderOptions(loadedOptions);
    const selectedCommander = resolveSelectedCommanderOption(
      selectableOptions,
      deck.commander,
      deck.commander_image,
    ) || currentCommander;

    setDeckCommanderOptions(selectableOptions);
    setSelectedDeckCommander(selectedCommander);
    void loadDeckCommanderArts(selectedCommander.name, selectedCommander.imageUrl);
  };

  const saveDeckCommanderPresentation = async (commanderName: string, imageUrl: string | null) => {
    if (!editingArtDeck) return;

    setSavingDeckArt(true);
    try {
      const colorFields = mergeDeckColorFields(editingArtDeck, deckCommanderOptions);
      const commanderCmc = await resolveDeckCommanderCmc(
        { commander: commanderName, commander_options: colorFields.commander_options },
        lookupCommanderCmcInBrowser,
      );
      const { error } = await supabase
        .from('decks')
        .update({
          commander: commanderName,
          commander_image: imageUrl,
          commander_cmc: commanderCmc,
          ...colorFields,
        })
        .eq('id', editingArtDeck.id);

      if (error) throw error;

      setDecks((currentDecks) => currentDecks.map((deck) =>
        deck.id === editingArtDeck.id
          ? {
              ...deck,
              commander: commanderName,
              commander_image: imageUrl,
              commander_cmc: commanderCmc,
              ...colorFields,
            }
          : deck
      ));
      setEditingArtDeck(null);
      setSelectedDeckCommander(null);
      setDeckCommanderOptions([]);
      setDeckArtOptions([]);
      toast({ title: t({ it: 'Comandante aggiornato', en: 'Commander updated' }) });
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile salvare il comandante', en: 'Failed to save commander' })),
        variant: 'destructive',
      });
    } finally {
      setSavingDeckArt(false);
    }
  };

  return {
    editingArtDeck, setEditingArtDeck, deckCommanderOptions, setDeckCommanderOptions,
    selectedDeckCommander, setSelectedDeckCommander, deckArtOptions, setDeckArtOptions,
    loadingDeckArtOptions, savingDeckArt, loadDeckCommanderArts, openDeckArtEditor, saveDeckCommanderPresentation,
  };
}
