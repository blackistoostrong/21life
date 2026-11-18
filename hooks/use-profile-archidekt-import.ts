'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { buildArchidektBatchCommanderSelections } from '@/lib/deck-importers';
import { normalizeImportedDeckPreview } from '@/lib/profile-commander';
import type { ImportedCommanderOption } from '@/lib/profile-commander';
import type { ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

/** Owns the public Archidekt username catalog preview and selected imports. */
export function useProfileArchidektImport() {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const [archidektUsername, setArchidektUsername] = useState('');

  const [importingUserDecks, setImportingUserDecks] = useState(false);

  const [importedUserDecks, setImportedUserDecks] = useState<ImportedDeckPreview[]>([]);

  const [selectedUserDeckCommanders, setSelectedUserDeckCommanders] = useState<Record<string, ImportedCommanderOption>>({});

  const [selectedUserDeckUrls, setSelectedUserDeckUrls] = useState<string[]>([]);

  const handleArchidektUserImport = async () => {
    if (!archidektUsername.trim()) return;

    setImportingUserDecks(true);
    try {
      const response = await authenticatedFetch('/api/archidekt-user-decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: archidektUsername }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t({ it: 'Importazione mazzi non riuscita', en: 'Failed to import decks' }));
      }

      const data = await response.json();
      const validDecks = await Promise.all(
        (Array.isArray(data.decks) ? data.decks : [])
          .filter((deck: ImportedDeckPreview) => Boolean(deck.sourceUrl && deck.sourceType))
          .map((deck: ImportedDeckPreview) => normalizeImportedDeckPreview(deck)),
      );
      const initialSelections = buildArchidektBatchCommanderSelections(validDecks);

      setImportedUserDecks(validDecks);
      setSelectedUserDeckCommanders(initialSelections);
      setSelectedUserDeckUrls(validDecks.map((deck: ImportedDeckPreview) => deck.sourceUrl));

      if (validDecks.length === 0) {
        toast({
          title: t({ it: 'Nessun mazzo pubblico trovato', en: 'No public decks found' }),
          description: t({ it: 'Archidekt non ha restituito mazzi Commander pubblici per questo utente.', en: 'Archidekt did not return public Commander decks for this user.' }),
        });
      }
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Importazione mazzi non riuscita', en: 'Failed to import decks' }),
        variant: 'destructive',
      });
    } finally {
      setImportingUserDecks(false);
    }
  };

  return {
    archidektUsername, setArchidektUsername, importingUserDecks,
    importedUserDecks, setImportedUserDecks,
    selectedUserDeckCommanders, setSelectedUserDeckCommanders,
    selectedUserDeckUrls, setSelectedUserDeckUrls, handleArchidektUserImport,
  };
}
