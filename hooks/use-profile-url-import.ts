'use client';

import { useCallback, useState, type SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getDefaultImportedCommanderOption, resolveImportedCommanderAfterArtsLoad } from '@/lib/deck-importers';
import { normalizeImportedDeckPreview } from '@/lib/profile-commander';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { useProfileCommandScope, type ProfileCommandJob } from '@/hooks/use-profile-command-scope';
import type { CommanderArtOption, ImportedCommanderOption } from '@/lib/profile-commander';
import type { ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

type Scope = ReturnType<typeof useProfileCommandScope>;
type State = {
  context: Scope['context']; url: string; previewEpoch: Scope['epoch'] | null;
  preview: ImportedDeckPreview | null; selected: ImportedCommanderOption | null; arts: CommanderArtOption[];
  importJob: ProfileCommandJob | null; artsJob: ProfileCommandJob | null;
};
const empty = (context: Scope['context']): State => ({ context, url: '', previewEpoch: null,
  preview: null, selected: null, arts: [], importJob: null, artsJob: null });

/** Read-only URL preview and artwork are isolated from persistence and other openings. */
export function useProfileUrlImport(key: string | null, enabled: boolean,
  fetchCommanderArts: (name: string, signal?: AbortSignal) => Promise<CommanderArtOption[]>) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const { context, epoch, committed, cancel, begin } = useProfileCommandScope(key, enabled);
  const [state, setState] = useState<State>(() => empty(context));
  const current = state.context === context ? state : empty(context);
  const importingDeck = current.importJob?.epoch === epoch;
  const visible = current.previewEpoch === epoch;
  const update = useCallback((action: (previous: State) => State, job?: ProfileCommandJob) => {
    if (!committed() || (job && !job.active())) return;
    setState(previous => !committed() || (job && !job.active()) ? previous
      : action(previous.context === context ? previous : empty(context)));
  }, [committed, context]);

  const resetUrlImport = () => { cancel(); update(() => empty(context)); };
  const setImportDeckUrl = (action: SetStateAction<string>) => {
    if (importingDeck) return;
    update(previous => ({ ...previous, url: typeof action === 'function' ? action(previous.url) : action }));
  };
  const loadImportedCommanderArts = async (commander: ImportedCommanderOption) => {
    const job = begin('arts', true);
    if (!job) return;
    update(previous => ({ ...previous, artsJob: job, selected: commander, arts: [] }), job);
    try {
      const arts = await withRequestDeadline({ abortSignal: signal => fetchCommanderArts(commander.name, signal) }, 15000, job.signal);
      update(previous => ({ ...previous, arts, selected: resolveImportedCommanderAfterArtsLoad(commander, arts) }), job);
    } catch {
      update(previous => ({ ...previous, selected: commander, arts: commander.imageUrl ? [{
        id: 'current', name: commander.name, imageUrl: commander.imageUrl,
        setName: t({ it: 'Art corrente', en: 'Current art' }), collectorNumber: '', releasedAt: null,
      }] : [] }), job);
    } finally {
      update(previous => ({ ...previous, artsJob: null }), job);
      job.finish();
    }
  };
  const handleUrlImport = async () => {
    if (!current.url.trim()) return;
    const job = begin('import');
    if (!job) return;
    cancel('arts');
    update(previous => ({ ...previous, importJob: job, artsJob: null }), job);
    try {
      const imported = await withRequestDeadline({ abortSignal: async signal => {
        const response = await authenticatedFetch('/api/deck-import', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: current.url }), signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t({ it: 'Importazione mazzo non riuscita', en: 'Failed to import deck' }));
        return normalizeImportedDeckPreview(data as ImportedDeckPreview, signal);
      } }, 15000, job.signal);
      if (!job.active()) return;
      const selected = getDefaultImportedCommanderOption(imported);
      update(previous => ({ ...previous, preview: imported, previewEpoch: job.epoch, selected }), job);
      void loadImportedCommanderArts(selected);
    } catch (error) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Importazione mazzo non riuscita', en: 'Failed to import deck' }),
        variant: 'destructive' });
    } finally {
      update(previous => ({ ...previous, importJob: null }), job);
      job.finish();
    }
  };
  const selectImportedCommander = (commander: ImportedCommanderOption) => { void loadImportedCommanderArts(commander); };
  const selectImportedArt = (art: CommanderArtOption) => {
    update(previous => ({ ...previous, selected: previous.selected ? { ...previous.selected, imageUrl: art.imageUrl } : null }));
  };
  return { importDeckUrl: current.url, setImportDeckUrl, importingDeck,
    importedDeck: visible ? current.preview : null, selectedImportedCommander: visible ? current.selected : null,
    importedCommanderArts: visible ? current.arts : [], loadingImportedCommanderArts: current.artsJob?.epoch === epoch,
    handleUrlImport, resetUrlImport, selectImportedCommander, selectImportedArt };
}

export type ProfileUrlImportControls = ReturnType<typeof useProfileUrlImport>;
