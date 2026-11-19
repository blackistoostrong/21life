'use client';
import { useRef, useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { delay } from '@/lib/async-utils';
import { deckDataToColorFields, getDefaultImportedCommanderOption } from '@/lib/deck-importers';
import { resolveDeckCommanderCmc } from '@/lib/deck-commander-cmc';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { SCRYFALL_REQUEST_GAP_MS, resolveImportedDeckCommanderImageForSave, manualDeckColorFields } from '@/lib/profile-commander';
import type { CommanderSearchResult, ImportedCommanderOption } from '@/lib/profile-commander';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

type Input = {
  user: { id: string } | null; adminMode: boolean; decks: Deck[];
  getTargetProfileId: () => string | null; getTargetProfileName: () => string | null;
  importedDeck: ImportedDeckPreview | null; selectedImportedCommander: ImportedCommanderOption | null;
  importedUserDecks: ImportedDeckPreview[]; selectedUserDeckUrls: string[];
  selectedUserDeckCommanders: Record<string, ImportedCommanderOption>;
  selectedCommander: CommanderSearchResult | null; selectedPartnerCommander: CommanderSearchResult | null;
  customDeckName: string; closeAddModal: () => void; fetchDecks: () => Promise<void>;
};

/** Owns persistence commands and overwrite confirmation, separate from read-only previews. */
export function useProfileDeckPersistence({ user, adminMode, decks, getTargetProfileId, getTargetProfileName,
  importedDeck, selectedImportedCommander, importedUserDecks, selectedUserDeckUrls, selectedUserDeckCommanders,
  selectedCommander, selectedPartnerCommander, customDeckName, closeAddModal, fetchDecks }: Input) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const [savingUserDecks, setSavingUserDecks] = useState(false);

  const [overwriteConfirm, setOverwriteConfirm] = useState<
    | { kind: 'single' }
    | { kind: 'bulk'; count: number }
    | null
  >(null);

  const overwriteResolver = useRef<((value: boolean | 'overwrite' | 'skip' | 'cancel') => void) | null>(null);

  const [savingDeck, setSavingDeck] = useState(false);

  const closeOverwriteConfirm = (value: boolean | 'overwrite' | 'skip' | 'cancel') => {
    overwriteResolver.current?.(value);
    overwriteResolver.current = null;
    setOverwriteConfirm(null);
  };

  const confirmOverwriteSingle = () => new Promise<boolean>((resolve) => {
    overwriteResolver.current = (value) => resolve(value === true);
    setOverwriteConfirm({ kind: 'single' });
  });

  const confirmOverwriteBulk = (count: number) => new Promise<'overwrite' | 'skip' | 'cancel'>((resolve) => {
    overwriteResolver.current = (value) => {
      if (value === 'overwrite' || value === 'skip' || value === 'cancel') {
        resolve(value);
        return;
      }
      resolve('cancel');
    };
    setOverwriteConfirm({ kind: 'bulk', count });
  });

  const saveArchidektDeck = async () => {
    const targetProfileId = getTargetProfileId();
    if (!importedDeck || !targetProfileId) return;

    const existingDeck = decks.find((deck) =>
      deck.user_id === targetProfileId && deck.source_url === importedDeck.sourceUrl
    );

    if (existingDeck) {
      const overwrite = await confirmOverwriteSingle();
      if (!overwrite) return;
    }

    setSavingDeck(true);
    try {
      const colorFields = deckDataToColorFields({
        commanderOptions: importedDeck.commanderOptions || [],
        colorIdentity: importedDeck.colorIdentity || [],
      });
      const selectedCommander = selectedImportedCommander || getDefaultImportedCommanderOption(importedDeck);
      const commander = selectedCommander.name || importedDeck.commander;
      const commanderCmc = await resolveDeckCommanderCmc(
        { commander, commander_options: colorFields.commander_options },
        lookupCommanderCmcInBrowser,
      );
      const commanderImage = await resolveImportedDeckCommanderImageForSave(
        selectedCommander,
        importedDeck,
        existingDeck?.commander_image,
      );
      const payload = {
        name: importedDeck.name,
        commander,
        commander_image: commanderImage,
        source_url: importedDeck.sourceUrl,
        source_type: importedDeck.sourceType,
        bracket: importedDeck.bracket,
        commander_cmc: commanderCmc,
        ...colorFields,
      };

      const { error } = existingDeck
        ? await supabase.from('decks').update(payload).eq('id', existingDeck.id)
        : await supabase.from('decks').insert({
          user_id: targetProfileId,
          group_id: null,
          ...payload,
        });

      if (error) throw error;

      toast({
        title: t({ it: existingDeck ? 'Mazzo aggiornato!' : 'Mazzo aggiunto!', en: existingDeck ? 'Deck updated!' : 'Deck added!' }),
        description: adminMode && getTargetProfileName()
          ? `${importedDeck.name} - ${getTargetProfileName()}`
          : importedDeck.name,
      });
      closeAddModal();
      fetchDecks();
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Salvataggio mazzo non riuscito', en: 'Failed to save deck' })),
        variant: 'destructive',
      });
    } finally {
      setSavingDeck(false);
    }
  };

  const saveArchidektUserDecks = async () => {
    const targetProfileId = getTargetProfileId();
    if (!targetProfileId || importedUserDecks.length === 0) return;

    const existingByUrl = new Map(
      decks
        .filter((deck) => deck.user_id === targetProfileId && deck.source_url)
        .map((deck) => [deck.source_url as string, deck]),
    );
    const selectedDecks = importedUserDecks.filter((deck) => selectedUserDeckUrls.includes(deck.sourceUrl));
    const duplicateCount = selectedDecks.filter((deck) => existingByUrl.has(deck.sourceUrl)).length;
    let overwriteExisting = false;

    if (duplicateCount > 0) {
      const choice = await confirmOverwriteBulk(duplicateCount);
      if (choice === 'cancel') return;
      overwriteExisting = choice === 'overwrite';
    }

    const decksToInsert = [];
    const decksToUpdate: Array<{ id: string; payload: Record<string, unknown> }> = [];

    for (const deck of selectedDecks) {
      const selectedCommander = selectedUserDeckCommanders[deck.sourceUrl] || getDefaultImportedCommanderOption(deck);
      const colorFields = deckDataToColorFields({
        commanderOptions: deck.commanderOptions || [],
        colorIdentity: deck.colorIdentity || [],
      });
      const commanderCmc = await resolveDeckCommanderCmc(
        { commander: selectedCommander.name, commander_options: colorFields.commander_options },
        lookupCommanderCmcInBrowser,
      );
      const existingDeck = existingByUrl.get(deck.sourceUrl);
      const commanderImage = await resolveImportedDeckCommanderImageForSave(
        selectedCommander,
        deck,
        existingDeck?.commander_image,
      );
      const payload = {
        name: deck.name,
        commander: selectedCommander.name,
        commander_image: commanderImage,
        source_url: deck.sourceUrl,
        source_type: deck.sourceType,
        bracket: deck.bracket,
        commander_cmc: commanderCmc,
        ...colorFields,
      };
      if (existingDeck) {
        if (overwriteExisting) {
          decksToUpdate.push({ id: existingDeck.id, payload });
        }
      } else {
        decksToInsert.push({
          user_id: targetProfileId,
          group_id: null,
          ...payload,
        });
      }

      await delay(SCRYFALL_REQUEST_GAP_MS);
    }

    if (decksToInsert.length === 0 && decksToUpdate.length === 0) {
      toast({
        title: t({ it: 'Nessun nuovo mazzo', en: 'No new decks' }),
        description: t({ it: 'I mazzi pubblici trovati sono gia presenti in quel profilo.', en: 'The public decks found are already saved in that profile.' }),
      });
      return;
    }

    setSavingUserDecks(true);
    try {
      if (targetProfileId === user?.id) {
        const { error } = await supabase.rpc('sync_archidekt_decks', {
          p_decks: [
            ...decksToInsert,
            ...decksToUpdate.map((entry) => entry.payload),
          ],
        });
        if (error) throw error;
      } else {
        if (decksToInsert.length > 0) {
          const { error } = await supabase.from('decks').insert(decksToInsert);
          if (error) throw error;
        }
        for (const deckUpdate of decksToUpdate) {
          const { error } = await supabase.from('decks').update(deckUpdate.payload).eq('id', deckUpdate.id);
          if (error) throw error;
        }
      }

      toast({
        title: t({ it: 'Mazzi importati!', en: 'Decks imported!' }),
        description: t({
          it: decksToUpdate.length > 0
            ? `${decksToInsert.length} aggiunti · ${decksToUpdate.length} aggiornati`
            : `${decksToInsert.length} ${decksToInsert.length === 1 ? 'mazzo aggiunto' : 'mazzi aggiunti'} al profilo.`,
          en: decksToUpdate.length > 0
            ? `${decksToInsert.length} added · ${decksToUpdate.length} updated`
            : `${decksToInsert.length} ${decksToInsert.length === 1 ? 'deck added' : 'decks added'} to your profile.`,
        }),
      });
      closeAddModal();
      fetchDecks();
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Salvataggio mazzi non riuscito', en: 'Failed to save decks' })),
        variant: 'destructive',
      });
    } finally {
      setSavingUserDecks(false);
    }
  };

  const saveManualDeck = async () => {
    const targetProfileId = getTargetProfileId();
    if (!selectedCommander || !targetProfileId) return;

    setSavingDeck(true);
    try {
      const commanderDisplayName = selectedPartnerCommander
        ? `${selectedCommander.name} // ${selectedPartnerCommander.name}`
        : selectedCommander.name;
      const colorFields = manualDeckColorFields(selectedCommander, selectedPartnerCommander);
      const commanderCmc = await resolveDeckCommanderCmc(
        { commander: commanderDisplayName, commander_options: colorFields.commander_options },
        lookupCommanderCmcInBrowser,
      );
      const { error } = await supabase.from('decks').insert({
        user_id: targetProfileId,
        group_id: null,
        name: customDeckName || commanderDisplayName,
        commander: commanderDisplayName,
        commander_image: selectedCommander.imageUrl,
        source_url: null,
        source_type: 'manual',
        bracket: null,
        commander_cmc: commanderCmc,
        ...colorFields,
      });

      if (error) throw error;

      toast({
        title: t({ it: 'Mazzo creato!', en: 'Deck created!' }),
        description: adminMode && getTargetProfileName()
          ? `${customDeckName || commanderDisplayName} - ${getTargetProfileName()}`
          : customDeckName || commanderDisplayName,
      });
      closeAddModal();
      fetchDecks();
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Salvataggio mazzo non riuscito', en: 'Failed to save deck' })),
        variant: 'destructive',
      });
    } finally {
      setSavingDeck(false);
    }
  };
  return { savingDeck, savingUserDecks, overwriteConfirm, closeOverwriteConfirm,
    saveArchidektDeck, saveArchidektUserDecks, saveManualDeck };
}
export type ProfileDeckPersistenceControls = ReturnType<typeof useProfileDeckPersistence>;
