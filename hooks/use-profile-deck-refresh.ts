'use client';
import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { useProfileCommandScope, type ProfileCommandJob } from '@/hooks/use-profile-command-scope';
import { deckDataToColorFields, isImportedDeckSource } from '@/lib/deck-importers';
import { resolveDeckCommanderCmc } from '@/lib/deck-commander-cmc';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { hasFreshEdhrecBadge, prefetchEdhrecStats } from '@/components/deck/edhrec-badge';
import { runTasksWithConcurrency } from '@/lib/async-utils';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

type Command = { job: ProfileCommandJob; signal: AbortSignal };
type Scope = ReturnType<typeof useProfileCommandScope>;
type State = { context: Scope['context']; job: ProfileCommandJob | null;
  kind: 'single' | 'bulk'; ids: string[] };
const empty = (context: Scope['context']): State => ({ context, job: null, kind: 'single', ids: [] });
function assertCommand(command: Command) {
  command.signal.throwIfAborted();
  if (!command.job.active()) throw new DOMException('Operation aborted', 'AbortError');
}
async function request<T>(command: Command, operation: (signal: AbortSignal) => PromiseLike<T>) {
  return withRequestDeadline({ abortSignal: signal => {
    assertCommand(command); signal.throwIfAborted(); return operation(signal);
  } }, 15000, command.signal);
}

/** One scoped command owns refresh IO; the caller continues to own the catalog. */
export function useProfileDeckRefresh(key: string | null, visibleDecks: Deck[], setDecks: Dispatch<SetStateAction<Deck[]>>) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const { context, epoch, committed, begin } = useProfileCommandScope(key, true);
  const [state, setState] = useState<State>(() => empty(context));
  const current = state.context === context ? state : empty(context);
  const refreshCommandsBusy = current.job?.epoch === epoch && current.job.active();
  const refreshingDecks = refreshCommandsBusy && current.kind === 'bulk';
  const refreshingDeckIds = refreshCommandsBusy ? current.ids : [];
  const update = (job: ProfileCommandJob, action: (previous: State) => State) => {
    if (!committed() || !job.active()) return;
    setState(previous => committed() && job.active() ? action(previous) : previous);
  };
  const run = async (kind: State['kind'], decks: Deck[], task: (command: Command) => Promise<void>) => {
    const job = begin('save');
    if (!job) return;
    const controller = new AbortController();
    const command: Command = { job, signal: AbortSignal.any([job.signal, controller.signal]) };
    update(job, () => ({ context, job, kind, ids: decks.map(deck => deck.id) }));
    try {
      await task(command);
    } catch (error) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : kind === 'bulk'
          ? t({ it: 'Aggiornamento mazzi non riuscito', en: 'Failed to refresh decks' })
          : t({ it: 'Aggiornamento mazzo non riuscito', en: 'Failed to refresh deck' }), variant: 'destructive' });
    } finally {
      // Stop sibling IO on an early worker failure. Keep the lease marker alive
      // so already acknowledged React updates remain valid until replacement.
      controller.abort();
      update(job, () => empty(context));
      job.finish();
    }
  };

  const refreshImportedDeck = async (deck: Deck, command: Command) => {
    assertCommand(command);
    if (deck.source_type === 'manual' || !deck.source_url) return null;

    const imported = await request(command, async signal => {
      const response = await authenticatedFetch('/api/deck-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: deck.source_url, fresh: true }), signal,
      });
      return response.ok ? await response.json() as ImportedDeckPreview : null;
    });
    assertCommand(command);
    if (!imported) return null;
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
    const commanderCmc = await request(command, signal => resolveDeckCommanderCmc(
      {
        commander: refreshedCommander,
        commander_options: colorFields.commander_options,
      },
      name => { signal.throwIfAborted(); return lookupCommanderCmcInBrowser(name, signal); },
    ));
    assertCommand(command);
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

    const { error } = await request(command, signal => supabase
      .from('decks').update(refreshedDeck).eq('id', deck.id).abortSignal(signal));
    assertCommand(command);

    if (error) return null;
    return { id: deck.id, ...refreshedDeck };
  };

  const handleRefreshImportedDeck = async (value: Deck) => {
    const deck = structuredClone(value);
    await run('single', [deck], async command => {
      const update = await refreshImportedDeck(deck, command);
      assertCommand(command);
      if (!update) {
        toast({
          title: t({ it: 'Mazzo non aggiornato', en: 'Deck not refreshed' }),
          description: t({ it: 'La fonte non ha restituito dati aggiornati.', en: 'The source did not return updated data.' }),
        });
        return;
      }

      setDecks((currentDecks) => command.job.active() ? currentDecks.map((currentDeck) =>
        currentDeck.id === deck.id ? { ...currentDeck, ...update } : currentDeck
      ) : currentDecks);
      toast({
        title: t({ it: 'Mazzo aggiornato', en: 'Deck refreshed' }),
        description: update.name,
      });
    });
  };

  const deckNeedsRefreshWork = useCallback((deck: Deck) => {
    const needsImportRefresh = isImportedDeckSource(deck.source_type) && Boolean(deck.source_url);
    const needsEdhrecRefresh = Boolean(deck.commander?.trim()) && !hasFreshEdhrecBadge(deck.commander);
    return needsImportRefresh || needsEdhrecRefresh;
  }, []);

  const consumeDeckRefreshBudget = (command: Command) => request(command, async signal => {
    const response = await fetch('/api/profile/deck-refresh-budget', { method: 'POST', signal });
    return response.ok;
  });

  const handleRefreshDecks = async () => {
    const decksToRefresh = structuredClone(visibleDecks.filter(deckNeedsRefreshWork));
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

    await run('bulk', decksToRefresh, async command => {
      let importedUpdates = 0;
      let edhrecUpdates = 0;
      let rateLimited = false;

      const results = await runTasksWithConcurrency(decksToRefresh, 2, async (deck) => {
        assertCommand(command);
        const hasBudget = await consumeDeckRefreshBudget(command);
        assertCommand(command);
        if (!hasBudget) {
          rateLimited = true;
          return null;
        }

        let commander = deck.commander;
        let deckUpdate: Awaited<ReturnType<typeof refreshImportedDeck>> = null;
        let edhrecRefreshed = false;

        if (isImportedDeckSource(deck.source_type) && deck.source_url) {
          deckUpdate = await refreshImportedDeck(deck, command);
          if (deckUpdate?.commander) {
            commander = deckUpdate.commander;
          }
        }

        if (commander?.trim() && !hasFreshEdhrecBadge(commander)) {
          assertCommand(command);
          // The existing public cache owns shared EDHREC IO; cancel this command's wait.
          const stats = await request(command, () => prefetchEdhrecStats(commander));
          assertCommand(command);
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

      assertCommand(command);
      const successfulResults = results.filter((result): result is NonNullable<typeof result> => Boolean(result));
      const successfulUpdates = successfulResults
        .map((result) => result.update)
        .filter((update): update is NonNullable<typeof update> => Boolean(update));

      importedUpdates = successfulResults.filter((result) => result.imported).length;
      edhrecUpdates = successfulResults.filter((result) => result.edhrecRefreshed).length;

      if (successfulUpdates.length > 0) {
        setDecks((currentDecks) => command.job.active() ? currentDecks.map((deck) => {
          const update = successfulUpdates.find((item) => item.id === deck.id);
          return update ? { ...deck, ...update } : deck;
        }) : currentDecks);
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
    });
  };
  return { refreshCommandsBusy, refreshingDecks, refreshingDeckIds, deckNeedsRefreshWork, handleRefreshDecks, handleRefreshImportedDeck };
}
