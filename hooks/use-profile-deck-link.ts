'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { deckDataToColorFields, isImportedDeckSource } from '@/lib/deck-importers';
import { resolveDeckCommanderCmc } from '@/lib/deck-commander-cmc';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

export function useProfileDeckLink(decks: Deck[], setDecks: Dispatch<SetStateAction<Deck[]>>) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const [linkingDeck, setLinkingDeck] = useState<Deck | null>(null);

  const [linkDeckUrl, setLinkDeckUrl] = useState('');

  const [savingDeckLink, setSavingDeckLink] = useState(false);

  const handleLinkDeckToExternalSource = async () => {
    if (!linkingDeck || !linkDeckUrl.trim()) return;
    setSavingDeckLink(true);
    try {
      const response = await authenticatedFetch('/api/deck-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkDeckUrl }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || t({ it: 'Link non valido.', en: 'Invalid link.' }));
      }

      const imported = await response.json() as ImportedDeckPreview;
      if (!isImportedDeckSource(imported.sourceType) || !imported.sourceUrl) {
        throw new Error(t({ it: 'Sono supportati solo Archidekt e Moxfield.', en: 'Only Archidekt and Moxfield are supported.' }));
      }
      const duplicate = decks.find((deck) =>
        deck.id !== linkingDeck.id
        && deck.user_id === linkingDeck.user_id
        && deck.source_url === imported.sourceUrl,
      );
      if (duplicate) {
        throw new Error(t({ it: 'Questa lista e gia collegata a un altro tuo mazzo.', en: 'This list is already linked to another one of your decks.' }));
      }

      const colorFields = deckDataToColorFields({
        commanderOptions: imported.commanderOptions || [],
        colorIdentity: imported.colorIdentity || [],
      });
      const commanderCmc = await resolveDeckCommanderCmc(
        { commander: linkingDeck.commander, commander_options: colorFields.commander_options },
        lookupCommanderCmcInBrowser,
      );
      const update = {
        source_url: imported.sourceUrl,
        source_type: imported.sourceType,
        bracket: imported.bracket,
        commander_cmc: commanderCmc ?? linkingDeck.commander_cmc,
        ...colorFields,
      };
      const { error } = await supabase.from('decks').update(update).eq('id', linkingDeck.id);
      if (error) throw error;

      setDecks((current) => current.map((deck) => deck.id === linkingDeck.id ? { ...deck, ...update } : deck));
      setLinkingDeck(null);
      setLinkDeckUrl('');
      toast({
        title: t({ it: 'Lista collegata', en: 'List linked' }),
        description: t({ it: 'Il mazzo manterra comandante e nome; da ora puo aggiornarsi dalla sorgente.', en: 'The deck keeps its commander and name; it can now refresh from its source.' }),
      });
    } catch (error) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile collegare la lista.', en: 'Unable to link the list.' })),
        variant: 'destructive',
      });
    } finally {
      setSavingDeckLink(false);
    }
  };
  return { linkingDeck, setLinkingDeck, linkDeckUrl, setLinkDeckUrl, savingDeckLink, handleLinkDeckToExternalSource };
}

export type ProfileDeckLinkControls = ReturnType<typeof useProfileDeckLink>;
