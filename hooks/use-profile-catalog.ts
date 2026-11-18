'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchCompleteProfileCatalog, fetchProfileCatalogPage, parseProfileCatalogPage } from '@/lib/profile-catalog-pages';
import type { ProfileDeck } from '@/lib/types/profile-deck';

type Context = { key: string | null };
type Owner = { context: Context; controller: AbortController | null };
type State = { context: Context; status: 'loading' | 'ready' | 'error'; decks: ProfileDeck[]; complete: boolean };
const EMPTY_DECKS: ProfileDeck[] = [];

/** Each committed account/admin context owns its requests and local updates. */
export function useProfileCatalog(user: { id: string } | null, adminMode: boolean, adminLoading: boolean) {
  const userId = user?.id ?? null;
  const key = userId && !adminLoading ? userId + ':' + adminMode : null;
  const context = useMemo<Context>(() => ({ key }), [key]);
  const ownerRef = useRef<Owner | null>(null);
  const [state, setState] = useState<State | null>(null);

  useLayoutEffect(() => {
    const owner: Owner = { context, controller: null };
    ownerRef.current = owner;
    return () => {
      owner.controller?.abort();
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [context]);

  const setDecks = useCallback((action: SetStateAction<ProfileDeck[]>) => {
    if (ownerRef.current?.context !== context) return;
    setState(current => {
      if (ownerRef.current?.context !== context || current?.context !== context) return current;
      return { ...current, decks: typeof action === 'function' ? action(current.decks) : action };
    });
  }, [context]);

  const loadCatalog = useCallback(async () => {
    const owner = ownerRef.current;
    if (!userId || !context.key || owner?.context !== context) return;
    owner.controller?.abort();
    const controller = new AbortController();
    owner.controller = controller;
    const active = () => ownerRef.current === owner && owner.controller === controller && !controller.signal.aborted;
    setState(current => ({ context, status: 'loading',
      decks: current?.context === context ? current.decks : EMPTY_DECKS,
      complete: current?.context === context && current.complete }));
    try {
      const data = await fetchCompleteProfileCatalog(async (after, revision, signal) => {
        if (!adminMode) return fetchProfileCatalogPage(supabase, userId, after, revision, signal);
        const params = new URLSearchParams();
        if (after) params.set('after', after);
        if (revision) params.set('revision', revision);
        const response = await fetch('/api/admin/profile-catalog?' + params, { cache: 'no-store', signal });
        if (!response.ok) throw new Error('PROFILE_CATALOG_UNAVAILABLE');
        return parseProfileCatalogPage(await response.json(), null, after, revision);
      }, controller.signal);
      if (!active()) return;
      const decks = data as ProfileDeck[];
      setState({ context, status: 'ready', decks, complete: true });
      return { decks, signal: controller.signal };
    } catch {
      if (active()) setState({ context, status: 'error', decks: EMPTY_DECKS, complete: false });
    }
  }, [adminMode, context, userId]);

  const current = state?.context === context ? state : null;
  return { decks: current?.decks ?? EMPTY_DECKS, setDecks,
    loading: !current || (current.status === 'loading' && !current.complete),
    catalogError: current?.status === 'error', loadCatalog };
}
