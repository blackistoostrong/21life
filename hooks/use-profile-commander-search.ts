'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { getCommanderPartnerMode } from '@/lib/commander-partners';
import { fetchCommanderSearchResults } from '@/lib/profile-commander';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import type { CommanderSearchResult, ManualPartnerMode } from '@/lib/profile-commander';

type Context = { key: string | null };
type State = { context: Context; query: string; results: CommanderSearchResult[]; busy: boolean };
type Owner = { context: Context; controller: AbortController | null };
const EMPTY_RESULTS: CommanderSearchResult[] = [];

/** Each channel owns its query, debounce timer and one cancellable request. */
function useSearchChannel(scope: string | null, enabled: boolean, mode: ManualPartnerMode | null,
  excludedName: string | null, selectedName: string | null = null) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const key = scope && enabled ? JSON.stringify([scope, mode, excludedName]) : null;
  const context = useMemo<Context>(() => ({ key }), [key]);
  const ownerRef = useRef<Owner | null>(null);
  const [state, setState] = useState<State>({ context, query: '', results: EMPTY_RESULTS, busy: false });
  const current = state.context === context ? state : null;
  const query = current?.query ?? '';

  useLayoutEffect(() => {
    const owner: Owner = { context, controller: null };
    ownerRef.current = owner;
    return () => {
      owner.controller?.abort();
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [context]);

  const update = useCallback((action: (previous: State) => State) => {
    if (!context.key || ownerRef.current?.context !== context) return;
    setState(previous => {
      if (ownerRef.current?.context !== context) return previous;
      return action(previous.context === context ? previous : { context, query: '', results: EMPTY_RESULTS, busy: false });
    });
  }, [context]);

  const setQuery = useCallback((action: SetStateAction<string>) => {
    if (ownerRef.current?.context !== context || !context.key) return;
    // Cancel immediately on input; a shorter query must not wait for another debounce.
    ownerRef.current.controller?.abort();
    update(previous => ({ ...previous, query: typeof action === 'function' ? action(previous.query) : action,
      results: EMPTY_RESULTS, busy: false }));
  }, [context, update]);
  const setResults = useCallback((action: SetStateAction<CommanderSearchResult[]>) => {
    update(previous => ({ ...previous, results: typeof action === 'function' ? action(previous.results) : action }));
  }, [update]);

  useEffect(() => {
    const owner = ownerRef.current;
    if (!context.key || owner?.context !== context || query.trim().length < 2 || query === selectedName) {
      update(previous => ({ ...previous, results: EMPTY_RESULTS, busy: false }));
      return;
    }
    const controller = new AbortController();
    owner.controller = controller;
    const active = () => ownerRef.current === owner && owner.controller === controller && !controller.signal.aborted;
    const timer = setTimeout(() => {
      if (!active()) return;
      update(previous => ({ ...previous, busy: true }));
      void (async () => {
        try {
          const results = await withRequestDeadline({ abortSignal: signal =>
            fetchCommanderSearchResults(query, mode, signal) }, 15000, controller.signal);
          if (!active()) return;
          update(previous => ({ ...previous, results: results.filter(result =>
            !excludedName || result.name.toLowerCase() !== excludedName.toLowerCase()) }));
        } catch (error) {
          if (!active() || (error instanceof Error && error.name === 'AbortError')) return;
          toast({ title: t({ it: 'Errore', en: 'Error' }),
            description: mode ? t({ it: 'Ricerca secondo comandante non riuscita', en: 'Failed to search second commander' })
              : t({ it: 'Ricerca comandanti non riuscita', en: 'Failed to search commanders' }), variant: 'destructive' });
        } finally {
          if (active()) update(previous => ({ ...previous, busy: false }));
        }
      })();
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [context, excludedName, mode, query, selectedName, t, toast, update]);

  return { query, setQuery, results: current?.results ?? EMPTY_RESULTS, setResults, busy: current?.busy ?? false };
}

/** Primary and partner channels have independent timers and account/modal leases. */
export function useProfileCommanderSearch(scope: string | null, enabled: boolean,
  selectedCommander: CommanderSearchResult | null, selectedPartnerCommander: CommanderSearchResult | null) {
  const primary = useSearchChannel(scope, enabled, null, null);
  const mode = selectedCommander ? getCommanderPartnerMode(selectedCommander) : null;
  const partner = useSearchChannel(scope, enabled && Boolean(mode), mode, selectedCommander?.name ?? null,
    selectedPartnerCommander?.name ?? null);
  return {
    searchQuery: primary.query, setSearchQuery: primary.setQuery,
    searchResults: primary.results, setSearchResults: primary.setResults, searching: primary.busy,
    partnerSearchQuery: partner.query, setPartnerSearchQuery: partner.setQuery,
    partnerSearchResults: partner.results, setPartnerSearchResults: partner.setResults, searchingPartner: partner.busy,
  };
}
