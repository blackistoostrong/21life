'use client';

import { useCallback, useState, type SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { buildArchidektBatchCommanderSelections } from '@/lib/deck-importers';
import { normalizeImportedDeckPreviews } from '@/lib/profile-commander';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { useProfileCommandScope, type ProfileCommandJob } from '@/hooks/use-profile-command-scope';
import type { ImportedCommanderOption } from '@/lib/profile-commander';
import type { ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

type Scope = ReturnType<typeof useProfileCommandScope>;
type Selections = Record<string, ImportedCommanderOption>;
type State = { context: Scope['context']; username: string; previewEpoch: Scope['epoch'] | null;
  decks: ImportedDeckPreview[]; selected: Selections; urls: string[]; job: ProfileCommandJob | null };
const EMPTY_DECKS: ImportedDeckPreview[] = [];
const EMPTY_SELECTIONS: Selections = {};
const EMPTY_URLS: string[] = [];
const empty = (context: Scope['context']): State => ({ context, username: '', previewEpoch: null,
  decks: EMPTY_DECKS, selected: EMPTY_SELECTIONS, urls: EMPTY_URLS, job: null });

/** The complete public catalog preview is scoped separately from its later persistence. */
export function useProfileArchidektImport(key: string | null, enabled: boolean) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const { context, epoch, committed, cancel, begin } = useProfileCommandScope(key, enabled);
  const [state, setState] = useState<State>(() => empty(context));
  const current = state.context === context ? state : empty(context);
  const visible = current.previewEpoch === epoch;
  const importingUserDecks = current.job?.epoch === epoch;
  const update = useCallback((action: (previous: State) => State, job?: ProfileCommandJob) => {
    if (!committed() || (job && !job.active())) return;
    setState(previous => !committed() || (job && !job.active()) ? previous
      : action(previous.context === context ? previous : empty(context)));
  }, [committed, context]);
  const setArchidektUsername = (action: SetStateAction<string>) => {
    if (importingUserDecks) return;
    update(previous => ({ ...previous, username: typeof action === 'function' ? action(previous.username) : action }));
  };
  const setSelectedUserDeckCommanders = (action: SetStateAction<Selections>) => {
    update(previous => ({ ...previous, selected: typeof action === 'function' ? action(previous.selected) : action }));
  };
  const setSelectedUserDeckUrls = (action: SetStateAction<string[]>) => {
    update(previous => ({ ...previous, urls: typeof action === 'function' ? action(previous.urls) : action }));
  };
  const clearArchidektPreview = () => {
    cancel();
    update(previous => ({ ...previous, decks: EMPTY_DECKS, selected: EMPTY_SELECTIONS,
      urls: EMPTY_URLS, job: null, previewEpoch: epoch }));
  };
  const resetArchidektImport = (username = '') => {
    cancel(); update(() => ({ ...empty(context), username }));
  };
  const handleArchidektUserImport = async () => {
    if (!current.username.trim()) return;
    const job = begin('import');
    if (!job) return;
    update(previous => ({ ...previous, job }), job);
    try {
      const data = await withRequestDeadline({ abortSignal: async signal => {
        const response = await authenticatedFetch('/api/archidekt-user-decks', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: current.username }), signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t({ it: 'Importazione mazzi non riuscita', en: 'Failed to import decks' }));
        return body;
      } }, 15000, job.signal);
      const candidates: ImportedDeckPreview[] = (Array.isArray(data.decks) ? data.decks : [])
        .filter((deck: ImportedDeckPreview) => Boolean(deck.sourceUrl && deck.sourceType));
      // Limit normalization, not just the HTTP start rate: large catalogs must not
      // fill the transport queue with already-expiring requests.
      const decks = await normalizeImportedDeckPreviews(candidates, job.signal);
      if (!job.active()) return;
      update(previous => ({ ...previous, decks, previewEpoch: job.epoch,
        selected: buildArchidektBatchCommanderSelections(decks), urls: decks.map(deck => deck.sourceUrl) }), job);
      if (!decks.length) toast({ title: t({ it: 'Nessun mazzo pubblico trovato', en: 'No public decks found' }),
        description: t({ it: 'Archidekt non ha restituito mazzi Commander pubblici per questo utente.', en: 'Archidekt did not return public Commander decks for this user.' }) });
    } catch (error) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Importazione mazzi non riuscita', en: 'Failed to import decks' }),
        variant: 'destructive' });
    } finally {
      update(previous => ({ ...previous, job: null }), job);
      job.finish();
    }
  };
  return { archidektUsername: current.username, setArchidektUsername, importingUserDecks,
    importedUserDecks: visible ? current.decks : EMPTY_DECKS,
    selectedUserDeckCommanders: visible ? current.selected : EMPTY_SELECTIONS, setSelectedUserDeckCommanders,
    selectedUserDeckUrls: visible ? current.urls : EMPTY_URLS, setSelectedUserDeckUrls,
    handleArchidektUserImport, clearArchidektPreview, resetArchidektImport };
}
