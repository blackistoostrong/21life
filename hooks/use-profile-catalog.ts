'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchCompleteProfileCatalog, fetchProfileCatalogPage, parseProfileCatalogPage } from '@/lib/profile-catalog-pages';
import type { ProfileDeck } from '@/lib/types/profile-deck';

const EMPTY_DECKS: ProfileDeck[] = [];

/** Owns catalog state and traversal; metadata enrichment stays with its caller. */
export function useProfileCatalog(user: { id: string } | null, adminMode: boolean, adminLoading: boolean) {
  const [catalogDecks, setDecks] = useState<ProfileDeck[]>([]);
  const catalogKey = user ? user.id + ':' + adminMode : null;
  const [loadedCatalogKey, setLoadedCatalogKey] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const catalogRequestRef = useRef<AbortController | null>(null);
  const decks = loadedCatalogKey === catalogKey ? catalogDecks : EMPTY_DECKS;
  const [loading, setLoading] = useState(true);

  useEffect(() => () => catalogRequestRef.current?.abort(), [catalogKey]);

  const loadCatalog = useCallback(async () => {
    if (!user || adminLoading) return;
    catalogRequestRef.current?.abort();
    const controller = new AbortController();
    catalogRequestRef.current = controller;
    setCatalogError(false);
    try {
      const data = await fetchCompleteProfileCatalog(async (after, revision, signal) => {
        if (!adminMode) return fetchProfileCatalogPage(supabase, user.id, after, revision, signal);
        const params = new URLSearchParams();
        if (after) params.set('after', after);
        if (revision) params.set('revision', revision);
        const response = await fetch('/api/admin/profile-catalog?' + params, { cache: 'no-store', signal });
        if (!response.ok) throw new Error('PROFILE_CATALOG_UNAVAILABLE');
        return parseProfileCatalogPage(await response.json(), null, after, revision);
      }, controller.signal);
      if (controller.signal.aborted) return;
      const loadedDecks = data as ProfileDeck[];
      setLoadedCatalogKey(catalogKey);
      setDecks(loadedDecks);
      return { decks: loadedDecks, signal: controller.signal };
    } catch {
      if (!controller.signal.aborted) {
        setCatalogError(true);
        setLoadedCatalogKey(catalogKey);
        setDecks([]);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [adminMode, adminLoading, catalogKey, user]);

  return { decks, setDecks, loading, catalogError, loadCatalog };
}
