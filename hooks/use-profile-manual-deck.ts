'use client';
import { useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useProfileCommanderSearch } from '@/hooks/use-profile-commander-search';
import { getCommanderPartnerCopy as getManualPartnerCopy, getCommanderPartnerMode as getManualPartnerMode } from '@/lib/commander-partners';
import type { CommanderSearchResult, CommanderArtOption } from '@/lib/profile-commander';

/** Owns the manual deck draft and its commander/art selection. */
export function useProfileManualDeck(scopeKey: string | null, enabled: boolean,
  fetchCommanderArts: (name: string, signal?: AbortSignal) => Promise<CommanderArtOption[]>) {
  const { copy: t } = useLanguage();
  const [selectedCommander, setSelectedCommander] = useState<CommanderSearchResult | null>(null);

  const [selectedPartnerCommander, setSelectedPartnerCommander] = useState<CommanderSearchResult | null>(null);

  const {
    searchQuery, setSearchQuery, searchResults, setSearchResults, searching,
    partnerSearchQuery, setPartnerSearchQuery, partnerSearchResults, setPartnerSearchResults,
    searchingPartner,
  } = useProfileCommanderSearch(scopeKey,
    enabled, selectedCommander, selectedPartnerCommander);

  const [manualCommanderArts, setManualCommanderArts] = useState<CommanderArtOption[]>([]);

  const [loadingManualCommanderArts, setLoadingManualCommanderArts] = useState(false);

  const [customDeckName, setCustomDeckName] = useState('');

  const manualPartnerMode = selectedCommander ? getManualPartnerMode(selectedCommander) : null;

  const manualPartnerCopy = manualPartnerMode ? getManualPartnerCopy(manualPartnerMode, t) : null;

  const loadManualCommanderArts = async (commanderName: string, fallbackImageUrl: string | null) => {
    setLoadingManualCommanderArts(true);
    try {
      const arts = await fetchCommanderArts(commanderName);
      setManualCommanderArts(arts);
      const firstArt = arts[0];
      if (firstArt) {
        setSelectedCommander((current) => current ? { ...current, imageUrl: firstArt.imageUrl } : current);
      } else if (fallbackImageUrl) {
        setManualCommanderArts([{
          id: 'current',
          name: commanderName,
          imageUrl: fallbackImageUrl,
          setName: t({ it: 'Art corrente', en: 'Current art' }),
          collectorNumber: '',
          releasedAt: null,
        }]);
      }
    } catch {
      setManualCommanderArts(fallbackImageUrl ? [{
        id: 'current',
        name: commanderName,
        imageUrl: fallbackImageUrl,
        setName: t({ it: 'Art corrente', en: 'Current art' }),
        collectorNumber: '',
        releasedAt: null,
      }] : []);
    } finally {
      setLoadingManualCommanderArts(false);
    }
  };

  const handleSelectCommander = (commander: CommanderSearchResult) => {
    setSelectedCommander(commander);
    setCustomDeckName(commander.name);
    setPartnerSearchQuery('');
    setPartnerSearchResults([]);
    setSelectedPartnerCommander(null);
    setManualCommanderArts([]);
    void loadManualCommanderArts(commander.name, commander.imageUrl);
  };
  return {
    selectedCommander, setSelectedCommander, selectedPartnerCommander, setSelectedPartnerCommander,
    searchQuery, setSearchQuery, searchResults, setSearchResults, searching,
    partnerSearchQuery, setPartnerSearchQuery, partnerSearchResults, setPartnerSearchResults, searchingPartner,
    manualCommanderArts, setManualCommanderArts, loadingManualCommanderArts, setLoadingManualCommanderArts,
    customDeckName, setCustomDeckName, manualPartnerMode, manualPartnerCopy, handleSelectCommander,
  };
}
export type ProfileManualDeckControls = ReturnType<typeof useProfileManualDeck>;
