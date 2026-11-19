'use client';
import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { deckDataToColorFields, isImportedDeckSource } from '@/lib/deck-importers';
import { resolveDeckCommanderCmc } from '@/lib/deck-commander-cmc';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { hasFreshEdhrecBadge, prefetchEdhrecStats } from '@/components/deck/edhrec-badge';
import { runTasksWithConcurrency } from '@/lib/async-utils';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

/** Existing external-source refresh commands; catalog remains owned by its caller. */
export function useProfileDeckRefresh(visibleDecks: Deck[], setDecks: Dispatch<SetStateAction<Deck[]>>) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const [refreshingDecks, setRefreshingDecks] = useState(false);

  const [refreshingDeckIds, setRefreshingDeckIds] = useState<string[]>([]);

  const refreshImportedDeck = async (deck: Deck) => {
    if (deck.source_type === 'manual' || !deck.source_url) return null;

    const response = await authenticatedFetch('/api/deck-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: deck.source_url, fresh: true }),
    });

    if (!response.ok) return null;

    const imported = await response.json() as ImportedDeckPreview;
    const importedCommanderOptions = imported.commanderOptions || [];
    const currentCommanderStillAvailable = importedCommanderOptions.some((option) =>
      option.name.toLowerCase() === deck.commander.toLowerCase()
    );
    const refreshedCommander = currentCommanderStillAvailable
      ? deck.commander
      : imported.commander || deck.commander;
    const refreshedCommanderOption = importedCommanderOptions.find((option) =>
      option.name.toLowerCase() === refreshedCommander.toLowerCase()
    );
    const colorFields = deckDataToColorFields({
      commanderOptions: importedCommanderOptions,
      colorIdentity: imported.colorIdentity || [],
    });
    const commanderCmc = await resolveDeckCommanderCmc(
      {
        commander: refreshedCommander,
        commander_options: colorFields.commander_options,
      },
      lookupCommanderCmcInBrowser,
    );
    const refreshedDeck = {
      name: imported.name || deck.name,
      commander: refreshedCommander,
      commander_image: currentCommanderStillAvailable
        ? deck.commander_image || refreshedCommanderOption?.imageUrl || imported.commanderImageUrl || null
        : refreshedCommanderOption?.imageUrl || imported.commanderImageUrl || deck.commander_image,
      bracket: typeof imported.bracket === 'string' ? imported.bracket : null,
      commander_cmc: commanderCmc ?? deck.commander_cmc,
      ...colorFields,
    };

    const { error } = await supabase
      .from('decks')
      .update(refreshedDeck)
      .eq('id', deck.id);

    if (error) return null;
    return { id: deck.id, ...refreshedDeck };
  };

  const handleRefreshImportedDeck = async (deck: Deck) => {
    setRefreshingDeckIds((ids) => [...ids, deck.id]);
    try {
      const update = await refreshImportedDeck(deck);
      if (!update) {
        toast({
          title: t({ it: 'Mazzo non aggiornato', en: 'Deck not refreshed' }),
          description: t({ it: 'La fonte non ha restituito dati aggiornati.', en: 'The source did not return updated data.' }),
        });
        return;
      }

      setDecks((currentDecks) => currentDecks.map((currentDeck) =>
        currentDeck.id === deck.id ? { ...currentDeck, ...update } : currentDeck
      ));
      toast({
        title: t({ it: 'Mazzo aggiornato', en: 'Deck refreshed' }),
        description: update.name,
      });
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Aggiornamento mazzo non riuscito', en: 'Failed to refresh deck' }),
        variant: 'destructive',
      });
    } finally {
      setRefreshingDeckIds((ids) => ids.filter((id) => id !== deck.id));
    }
  };

  const deckNeedsRefreshWork = useCallback((deck: Deck) => {
    const needsImportRefresh = isImportedDeckSource(deck.source_type) && Boolean(deck.source_url);
    const needsEdhrecRefresh = Boolean(deck.commander?.trim()) && !hasFreshEdhrecBadge(deck.commander);
    return needsImportRefresh || needsEdhrecRefresh;
  }, []);

  const consumeDeckRefreshBudget = useCallback(async () => {
    const response = await fetch('/api/profile/deck-refresh-budget', { method: 'POST' });
    return response.ok;
  }, []);

  const handleRefreshDecks = async () => {
    const decksToRefresh = visibleDecks.filter(deckNeedsRefreshWork);
    if (decksToRefresh.length === 0) {
      toast({
        title: t({ it: 'Nessun aggiornamento necessario', en: 'No refresh needed' }),
        description: t({
          it: 'Tutti i mazzi visibili hanno già dati import e badge EDHREC aggiornati.',
          en: 'All visible decks already have up-to-date import data and EDHREC badges.',
        }),
      });
      return;
    }

    setRefreshingDecks(true);
    setRefreshingDeckIds(decksToRefresh.map((deck) => deck.id));

    let importedUpdates = 0;
    let edhrecUpdates = 0;
    let rateLimited = false;

    try {
      const results = await runTasksWithConcurrency(decksToRefresh, 2, async (deck) => {
        const hasBudget = await consumeDeckRefreshBudget();
        if (!hasBudget) {
          rateLimited = true;
          return null;
        }

        let commander = deck.commander;
        let deckUpdate: Awaited<ReturnType<typeof refreshImportedDeck>> = null;
        let edhrecRefreshed = false;

        if (isImportedDeckSource(deck.source_type) && deck.source_url) {
          deckUpdate = await refreshImportedDeck(deck);
          if (deckUpdate?.commander) {
            commander = deckUpdate.commander;
          }
        }

        if (commander?.trim() && !hasFreshEdhrecBadge(commander)) {
          const stats = await prefetchEdhrecStats(commander);
          if (stats) {
            edhrecRefreshed = true;
          }
        }

        return {
          deckId: deck.id,
          update: deckUpdate,
          imported: Boolean(deckUpdate),
          edhrecRefreshed,
        };
      });

      const successfulResults = results.filter((result): result is NonNullable<typeof result> => Boolean(result));
      const successfulUpdates = successfulResults
        .map((result) => result.update)
        .filter((update): update is NonNullable<typeof update> => Boolean(update));

      importedUpdates = successfulResults.filter((result) => result.imported).length;
      edhrecUpdates = successfulResults.filter((result) => result.edhrecRefreshed).length;

      if (successfulUpdates.length > 0) {
        setDecks((currentDecks) => currentDecks.map((deck) => {
          const update = successfulUpdates.find((item) => item.id === deck.id);
          return update ? { ...deck, ...update } : deck;
        }));
      }

      if (importedUpdates === 0 && edhrecUpdates === 0) {
        toast({
          title: t({ it: 'Nessun mazzo aggiornato', en: 'No decks updated' }),
          description: rateLimited
            ? t({
              it: 'Limite raggiunto: massimo 200 mazzi ogni 10 minuti.',
              en: 'Rate limit reached: maximum 200 decks every 10 minutes.',
            })
            : t({ it: 'Le fonti non hanno restituito nuovi dati.', en: 'The sources did not return updated data.' }),
          variant: rateLimited ? 'destructive' : 'default',
        });
        return;
      }

      toast({
        title: t({ it: 'Aggiornamento completato', en: 'Refresh completed' }),
        description: t({
          it: `${importedUpdates} import, ${edhrecUpdates} EDHREC${rateLimited ? ' · limite 200/10 min raggiunto per i restanti' : ''}`,
          en: `${importedUpdates} imports, ${edhrecUpdates} EDHREC${rateLimited ? ' · 200/10 min limit reached for remaining decks' : ''}`,
        }),
      });
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Aggiornamento mazzi non riuscito', en: 'Failed to refresh decks' }),
        variant: 'destructive',
      });
    } finally {
      setRefreshingDecks(false);
      setRefreshingDeckIds([]);
    }
  };
  return { refreshingDecks, refreshingDeckIds, deckNeedsRefreshWork, handleRefreshDecks, handleRefreshImportedDeck };
}
