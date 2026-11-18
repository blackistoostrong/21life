'use client';

import { useCallback } from 'react';
import { useLanguage } from '@/components/language-provider';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { fetchScryfallArtOptionsFromBrowser } from '@/lib/profile-commander';
import type { CommanderArtOption } from '@/lib/profile-commander';

/** Shared browser-first art lookup; feature callers own selection and request lifetime. */
export function useProfileCommanderArts() {
  const { copy: t } = useLanguage();
  return useCallback(async (commanderName: string) => {
    try {
      const arts = await fetchScryfallArtOptionsFromBrowser(commanderName);
      if (arts.length > 0) return arts;
    } catch {
      // Fall back to the server route below.
    }

    const response = await authenticatedFetch(`/api/scryfall-card-arts?name=${encodeURIComponent(commanderName)}`);
    if (!response.ok) throw new Error(t({ it: 'Ricerca art non riuscita', en: 'Art search failed' }));

    const data = await response.json();
    return Array.isArray(data.data) ? data.data as CommanderArtOption[] : [];
  }, [t]);
}
