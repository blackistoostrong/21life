'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { getCommanderPartnerMode as getManualPartnerMode } from '@/lib/commander-partners';
import { fetchCommanderSearchResults } from '@/lib/profile-commander';
import type { CommanderSearchResult, ManualPartnerMode } from '@/lib/profile-commander';

/** Owns existing manual/partner search state, debounce timers and requests. */
export function useProfileCommanderSearch(showAddModal: boolean,
  selectedCommander: CommanderSearchResult | null, selectedPartnerCommander: CommanderSearchResult | null) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const commanderSearchAbortRef = useRef<AbortController | null>(null);

  const partnerSearchAbortRef = useRef<AbortController | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  const [searchResults, setSearchResults] = useState<CommanderSearchResult[]>([]);

  const [searching, setSearching] = useState(false);

  const [partnerSearchQuery, setPartnerSearchQuery] = useState('');

  const [partnerSearchResults, setPartnerSearchResults] = useState<CommanderSearchResult[]>([]);

  const [searchingPartner, setSearchingPartner] = useState(false);

  const searchCommanders = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    commanderSearchAbortRef.current?.abort();
    const controller = new AbortController();
    commanderSearchAbortRef.current = controller;

    setSearching(true);
    try {
      const results = await fetchCommanderSearchResults(query, null, controller.signal);
      if (controller.signal.aborted) return;
      setSearchResults(results);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Ricerca comandanti non riuscita', en: 'Failed to search commanders' }),
        variant: 'destructive',
      });
    } finally {
      if (commanderSearchAbortRef.current === controller) {
        setSearching(false);
      }
    }
  }, [t, toast]);

  const searchPartnerCommanders = useCallback(async (query: string, partnerMode: ManualPartnerMode | null, primaryCommander: CommanderSearchResult | null) => {
    if (query.length < 2 || !partnerMode || !primaryCommander) {
      setPartnerSearchResults([]);
      return;
    }

    partnerSearchAbortRef.current?.abort();
    const controller = new AbortController();
    partnerSearchAbortRef.current = controller;

    setSearchingPartner(true);
    try {
      const results = await fetchCommanderSearchResults(query, partnerMode, controller.signal);
      if (controller.signal.aborted) return;
      setPartnerSearchResults(results.filter((result) => result.name.toLowerCase() !== primaryCommander.name.toLowerCase()));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Ricerca secondo comandante non riuscita', en: 'Failed to search second commander' }),
        variant: 'destructive',
      });
    } finally {
      if (partnerSearchAbortRef.current === controller) {
        setSearchingPartner(false);
      }
    }
  }, [t, toast]);

  useEffect(() => {
    if (showAddModal) {
      commanderSearchAbortRef.current?.abort();
      partnerSearchAbortRef.current?.abort();
    }
  }, [showAddModal]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery) {
        searchCommanders(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, searchCommanders]);

  useEffect(() => {
    const partnerMode = selectedCommander ? getManualPartnerMode(selectedCommander) : null;
    const timer = setTimeout(() => {
      if (selectedPartnerCommander && partnerSearchQuery === selectedPartnerCommander.name) {
        setPartnerSearchResults([]);
        return;
      }

      if (partnerSearchQuery) {
        searchPartnerCommanders(partnerSearchQuery, partnerMode, selectedCommander);
      } else {
        setPartnerSearchResults([]);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [partnerSearchQuery, selectedCommander, selectedPartnerCommander, searchPartnerCommanders]);

  return {
    searchQuery, setSearchQuery, searchResults, setSearchResults, searching, setSearching,
    partnerSearchQuery, setPartnerSearchQuery, partnerSearchResults, setPartnerSearchResults,
    searchingPartner, setSearchingPartner,
  };
}
