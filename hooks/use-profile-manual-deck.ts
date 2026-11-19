'use client';

import { useCallback, useRef, useState, type SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useProfileCommanderSearch } from '@/hooks/use-profile-commander-search';
import { useProfileCommandScope, type ProfileCommandJob } from '@/hooks/use-profile-command-scope';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { getCommanderPartnerCopy as getManualPartnerCopy, getCommanderPartnerMode as getManualPartnerMode } from '@/lib/commander-partners';
import type { CommanderSearchResult, CommanderArtOption } from '@/lib/profile-commander';

type Scope = ReturnType<typeof useProfileCommandScope>;
type Fields = { primary: CommanderSearchResult | null; partner: CommanderSearchResult | null;
  arts: CommanderArtOption[]; name: string; job: ProfileCommandJob | null };
type State = Fields & { epoch: Scope['epoch'] };
const empty = (epoch: Scope['epoch']): State => ({ epoch, primary: null, partner: null, arts: [], name: '', job: null });

/** Private draft and art requests belong to the committed account and manual opening. */
export function useProfileManualDeck(scopeKey: string | null, enabled: boolean,
  fetchCommanderArts: (name: string, signal?: AbortSignal) => Promise<CommanderArtOption[]>) {
  const { copy: t } = useLanguage();
  const { epoch, committed, begin, cancel } = useProfileCommandScope(scopeKey, enabled);
  const [state, setState] = useState<State>(() => empty(epoch));
  const current = state.epoch === epoch ? state : empty(epoch);
  const frozenArt = useRef<ProfileCommandJob | null>(null);
  const search = useProfileCommanderSearch(scopeKey, enabled, current.primary, current.partner);
  const update = useCallback((action: (previous: State) => State, job?: ProfileCommandJob) => {
    if (!committed() || (job && !job.active())) return;
    setState(previous => !committed() || (job && !job.active()) ? previous : action(previous.epoch === epoch ? previous : empty(epoch)));
  }, [committed, epoch]);
  const assign = <K extends keyof Fields>(field: K, action: SetStateAction<Fields[K]>) => {
    update(previous => ({ ...previous, [field]: typeof action === 'function'
      ? (action as (value: Fields[K]) => Fields[K])(previous[field]) : action }));
  };
  const setSelectedCommander = (action: SetStateAction<CommanderSearchResult | null>) => {
    cancel('arts');
    update(previous => ({ ...previous, job: null, primary: typeof action === 'function' ? action(previous.primary) : action }));
  };
  const setManualCommanderArts = (action: SetStateAction<CommanderArtOption[]>) => {
    cancel('arts'); assign('arts', action);
    update(previous => ({ ...previous, job: null }));
  };
  const setLoadingManualCommanderArts = (value: boolean) => {
    if (!value) { cancel('arts'); update(previous => ({ ...previous, job: null })); }
  };
  // Saving freezes the displayed choice, not the optional art catalog. A late
  // printing response may populate options without changing the submitted art.
  const freezeManualSelection = () => { if (committed()) frozenArt.current = current.job; };
  const handleSelectCommander = (commander: CommanderSearchResult) => {
    const job = begin('arts', true);
    if (!job) return;
    frozenArt.current = null;
    search.setPartnerSearchQuery(''); search.setPartnerSearchResults([]);
    update(() => ({ ...empty(epoch), primary: commander, name: commander.name, job }), job);
    const fallback = () => commander.imageUrl ? [{ id: 'current', name: commander.name, imageUrl: commander.imageUrl,
      setName: t({ it: 'Art corrente', en: 'Current art' }), collectorNumber: '', releasedAt: null }] : [];
    void (async () => {
      try {
        const arts = await withRequestDeadline({ abortSignal: signal => fetchCommanderArts(commander.name, signal) }, 15000, job.signal);
        update(previous => ({ ...previous, arts: arts.length ? arts : fallback(),
          primary: arts[0] && previous.primary && frozenArt.current !== job
            ? { ...previous.primary, imageUrl: arts[0].imageUrl } : previous.primary }), job);
      } catch {
        update(previous => ({ ...previous, arts: fallback() }), job);
      } finally {
        update(previous => ({ ...previous, job: null }), job);
        job.finish();
      }
    })();
  };
  const manualPartnerMode = current.primary ? getManualPartnerMode(current.primary) : null;
  return {
    selectedCommander: current.primary, setSelectedCommander,
    selectedPartnerCommander: current.partner,
    setSelectedPartnerCommander: (action: SetStateAction<CommanderSearchResult | null>) => assign('partner', action),
    ...search, manualCommanderArts: current.arts, setManualCommanderArts,
    loadingManualCommanderArts: current.job?.epoch === epoch && current.job.active(), setLoadingManualCommanderArts,
    customDeckName: current.name, setCustomDeckName: (action: SetStateAction<string>) => assign('name', action),
    manualPartnerMode, manualPartnerCopy: manualPartnerMode ? getManualPartnerCopy(manualPartnerMode, t) : null,
    handleSelectCommander, freezeManualSelection,
  };
}
export type ProfileManualDeckControls = ReturnType<typeof useProfileManualDeck>;
