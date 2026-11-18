'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getDefaultImportedCommanderOption, resolveImportedCommanderAfterArtsLoad } from '@/lib/deck-importers';
import { normalizeImportedDeckPreview } from '@/lib/profile-commander';
import type { CommanderArtOption, ImportedCommanderOption } from '@/lib/profile-commander';
import type { ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

/** Owns one existing URL preview, its input, commander selection and art state. */
export function useProfileUrlImport(fetchCommanderArts: (name: string) => Promise<CommanderArtOption[]>) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const [importDeckUrl, setImportDeckUrl] = useState('');

  const [importingDeck, setImportingDeck] = useState(false);

  const [importedDeck, setImportedDeck] = useState<ImportedDeckPreview | null>(null);

  const [selectedImportedCommander, setSelectedImportedCommander] = useState<ImportedCommanderOption | null>(null);

  const [importedCommanderArts, setImportedCommanderArts] = useState<CommanderArtOption[]>([]);

  const [loadingImportedCommanderArts, setLoadingImportedCommanderArts] = useState(false);

  const handleUrlImport = async () => {
    if (!importDeckUrl.trim()) return;

    setImportingDeck(true);
    try {
      const response = await authenticatedFetch('/api/deck-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importDeckUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t({ it: 'Importazione mazzo non riuscita', en: 'Failed to import deck' }));
      }

      const imported = await normalizeImportedDeckPreview(await response.json() as ImportedDeckPreview);
      const defaultCommander = getDefaultImportedCommanderOption(imported);
      setImportedDeck(imported);
      setSelectedImportedCommander(defaultCommander);
      void loadImportedCommanderArts(defaultCommander);
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Importazione mazzo non riuscita', en: 'Failed to import deck' }),
        variant: 'destructive',
      });
    } finally {
      setImportingDeck(false);
    }
  };

  const loadImportedCommanderArts = async (commander: ImportedCommanderOption) => {
    setLoadingImportedCommanderArts(true);
    try {
      const arts = await fetchCommanderArts(commander.name);
      setImportedCommanderArts(arts);
      setSelectedImportedCommander(resolveImportedCommanderAfterArtsLoad(commander, arts));
    } catch {
      setImportedCommanderArts(commander.imageUrl ? [{
        id: 'current',
        name: commander.name,
        imageUrl: commander.imageUrl,
        setName: t({ it: 'Art corrente', en: 'Current art' }),
        collectorNumber: '',
        releasedAt: null,
      }] : []);
      setSelectedImportedCommander(commander);
    } finally {
      setLoadingImportedCommanderArts(false);
    }
  };

  return {
    importDeckUrl, setImportDeckUrl, importingDeck, importedDeck, setImportedDeck,
    selectedImportedCommander, setSelectedImportedCommander,
    importedCommanderArts, setImportedCommanderArts, loadingImportedCommanderArts, setLoadingImportedCommanderArts,
    handleUrlImport, loadImportedCommanderArts,
  };
}
