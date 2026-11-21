'use client';

import { useCallback, useRef, useState, type SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { getCommanderOptions, filterSelectableCommanderOptions, resolveSelectedCommanderOption, mergeDeckColorFields } from '@/lib/deck-metadata';
import { isImportedDeckSource } from '@/lib/deck-importers';
import { uniqueCommanderOptions } from '@/lib/profile-commander';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { parseStoredCommanderCmc, resolveDeckCommanderCmc } from '@/lib/deck-commander-cmc';
import { resolvePresentationCommanderCmc } from '@/packages/domain/commander-presentation';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { useProfileCommandScope, type ProfileCommandJob } from '@/hooks/use-profile-command-scope';
import type { CommanderArtOption, ImportedCommanderOption } from '@/lib/profile-commander';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

type Context = ReturnType<typeof useProfileCommandScope>['context'];
type State = { context: Context; session: object | null; deck: Deck | null;
  options: ImportedCommanderOption[]; selected: ImportedCommanderOption | null; arts: CommanderArtOption[];
  openJob: ProfileCommandJob | null; artsJob: ProfileCommandJob | null; saveJob: ProfileCommandJob | null };
const empty = (context: Context): State => ({ context, session: null, deck: null, options: [], selected: null,
  arts: [], openJob: null, artsJob: null, saveJob: null });

/** Every opening and acknowledged save belongs to one account/role and deck snapshot. */
export function useProfileCommanderEditor(key: string | null,
  fetchCommanderArts: (name: string, signal?: AbortSignal) => Promise<CommanderArtOption[]>,
  setDecks: (action: SetStateAction<Deck[]>) => void) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const { context, committed, begin, cancel, pending } = useProfileCommandScope(key, true);
  const [state, setState] = useState<State>(() => empty(context));
  const sessionRef = useRef<object | null>(null);
  const current = state.context === context ? state : empty(context);
  const active = (job: ProfileCommandJob, session: object) => job.active() && sessionRef.current === session;
  const update = useCallback((action: (previous: State) => State, job?: ProfileCommandJob, session?: object) => {
    const allowed = () => committed() && (!job || job.active()) && (!session || sessionRef.current === session);
    if (!allowed()) return;
    setState(previous => allowed() ? action(previous.context === context ? previous : empty(context)) : previous);
  }, [committed, context]);

  const closeForSession = (session: object | null) => {
    if (!committed() || sessionRef.current !== session) return;
    cancel(); sessionRef.current = null; update(() => empty(context));
  };
  const loadDeckCommanderArts = async (session: object, commander: ImportedCommanderOption) => {
    if (sessionRef.current !== session || pending('save')) return;
    const job = begin('arts', true);
    if (!job) return;
    update(previous => ({ ...previous, selected: commander, arts: [], artsJob: job }), job, session);
    try {
      const arts = await withRequestDeadline({ abortSignal: signal => fetchCommanderArts(commander.name, signal) }, 15000, job.signal);
      const currentArt: CommanderArtOption[] = commander.imageUrl ? [{ id: 'current', name: commander.name,
        imageUrl: commander.imageUrl, setName: t({ it: 'Art corrente', en: 'Current art' }), collectorNumber: '', releasedAt: null }] : [];
      const uniqueArts = [...currentArt, ...arts].filter((art, index, all) => all.findIndex(other => other.imageUrl === art.imageUrl) === index);
      update(previous => ({ ...previous, arts: uniqueArts }), job, session);
    } catch (error) {
      if (active(job, session)) toast({ title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Impossibile caricare le art', en: 'Failed to load arts' }), variant: 'destructive' });
    } finally {
      update(previous => ({ ...previous, artsJob: null }), job, session); job.finish();
    }
  };
  const openDeckArtEditor = async (deck: Deck) => {
    if (!committed() || pending('save')) return;
    cancel();
    const session = {}; sessionRef.current = session;
    const job = begin('import');
    if (!job) return;
    update(() => ({ ...empty(context), session, deck, openJob: job }), job, session);
    try {
      const currentCommander = { name: deck.commander, imageUrl: deck.commander_image };
      let loadedOptions: ImportedCommanderOption[] = [currentCommander];
      const storedOptions = getCommanderOptions(deck);
      if (storedOptions.length) loadedOptions = uniqueCommanderOptions([currentCommander, ...storedOptions]);
      else if (isImportedDeckSource(deck.source_type) && deck.source_url) {
        try {
          const imported = await withRequestDeadline({ abortSignal: async signal => {
            const response = await authenticatedFetch('/api/deck-import', { method: 'POST',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: deck.source_url }), signal });
            return response.ok ? await response.json() as ImportedDeckPreview : null;
          } }, 15000, job.signal);
          if (imported?.commanderOptions?.length) loadedOptions = uniqueCommanderOptions([currentCommander, ...imported.commanderOptions]);
        } catch { if (!active(job, session)) return; }
      }
      if (!active(job, session)) return;
      const options = filterSelectableCommanderOptions(loadedOptions);
      const selected = resolveSelectedCommanderOption(options, deck.commander, deck.commander_image) || currentCommander;
      update(previous => ({ ...previous, options, selected }), job, session);
      void loadDeckCommanderArts(session, selected);
    } finally {
      update(previous => ({ ...previous, openJob: null }), job, session); job.finish();
    }
  };
  const saveDeckCommanderPresentation = async (commanderName: string, imageUrl: string | null) => {
    const { deck, session, options } = current;
    if (!deck || !session || sessionRef.current !== session || !commanderName.trim()) return;
    const job = begin('save');
    if (!job) return;
    cancel('arts'); cancel('import');
    update(previous => ({ ...previous, saveJob: job, artsJob: null, openJob: null }), job, session);
    try {
      const payload = await withRequestDeadline({ abortSignal: async signal => {
        const colorFields = mergeDeckColorFields(deck, options);
        const resolved = await resolveDeckCommanderCmc({ commander: commanderName, commander_options: colorFields.commander_options },
          name => lookupCommanderCmcInBrowser(name, signal));
        // A cached optional lookup may resolve after cancellation. Never start a
        // private write once the deadline or owning editor has expired.
        signal.throwIfAborted();
        if (!active(job, session)) throw Object.assign(new Error('Operation aborted'), { name: 'AbortError' });
        const commanderCmc = resolvePresentationCommanderCmc({ previousCommander: deck.commander, nextCommander: commanderName,
          storedCmc: parseStoredCommanderCmc(deck.commander_cmc), resolvedCmc: resolved });
        const value = { commander: commanderName, commander_image: imageUrl, commander_cmc: commanderCmc, ...colorFields };
        const { error } = await supabase.from('decks').update(value).eq('id', deck.id).abortSignal(signal);
        if (error) throw error;
        return value;
      } }, 15000, job.signal);
      if (!active(job, session)) return;
      setDecks(decks => decks.map(item => item.id === deck.id ? { ...item, ...payload } : item));
      closeForSession(session);
      toast({ title: t({ it: 'Comandante aggiornato', en: 'Commander updated' }) });
    } catch (error) {
      if (active(job, session)) toast({ title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile salvare il comandante', en: 'Failed to save commander' })), variant: 'destructive' });
    } finally {
      update(previous => ({ ...previous, saveJob: null }), job, session); job.finish();
    }
  };
  const selectDeckCommander = (commander: ImportedCommanderOption) => {
    if (current.session && !pending('save')) void loadDeckCommanderArts(current.session, commander);
  };
  return { editingArtDeck: current.deck, deckCommanderOptions: current.options, selectedDeckCommander: current.selected,
    deckArtOptions: current.arts, loadingDeckArtOptions: Boolean(current.openJob || current.artsJob),
    savingDeckArt: Boolean(current.saveJob), openDeckArtEditor, selectDeckCommander, saveDeckCommanderPresentation,
    closeCommanderEditor: () => closeForSession(current.session) };
}
