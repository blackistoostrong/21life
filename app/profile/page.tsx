'use client';

import {
  SCRYFALL_REQUEST_GAP_MS,
  normalizeImportedDeckPreview,
  resolveImportedDeckCommanderImageForSave,
  resolveCommanderColorOptions,
  fetchCommanderSearchResults,
  fetchScryfallArtOptionsFromBrowser,
  uniqueCommanderOptions,
} from '@/lib/profile-commander';
import type { CommanderArtOption } from '@/lib/profile-commander';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MotionItem, MotionList, MotionPanel } from '@/components/ui/motion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { AppLoader } from '@/components/ui/app-loader';
import { ManaLogo } from '@/components/ui/mana-logo';
import { AppProfileButton } from '@/components/navigation/app-profile-button';
import { DeckPerformancePanel } from '@/components/profile/deck-performance-panel';
import { DeckCollectionInsights } from '@/components/profile/deck-collection-insights';
import { DeckMasteryBadge } from '@/components/profile/deck-mastery-badge';
import { DeckImage } from '@/components/deck-image';
import { useLanguage } from '@/components/language-provider';
import { usePlatformAdmin } from '@/hooks/use-platform-admin';

import { RESERVED_USERNAMES } from '@/lib/reserved-usernames';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import {
  buildDeckColorFields,
  deckHasColorIdentity,
  filterSelectableCommanderOptions,
  getCommanderOptions,
  getDeckDisplayColors,
  mergeDeckColorFields,
  normalizeDeckColorIdentity,
  resolveSelectedCommanderOption,
} from '@/lib/deck-metadata';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { buildCommanderNameSearchClause } from '@/lib/commander-search-aliases';

import type { CommanderPartnerMode } from '@/lib/scryfall';
import {
  buildArchidektBatchCommanderSelections,
  deckDataToColorFields,
  getDefaultImportedCommanderOption,
  isImportedCommanderOptionSelected,
  isImportedDeckSource,
  repairImportedCommanderOptions,
  resolveImportedCommanderAfterArtsLoad,
  resolveImportedDeckCommanderImage,
} from '@/lib/deck-importers';
import {
  resolveDeckCommanderCmc,
} from '@/lib/deck-commander-cmc';
import { DeckExternalLinkChip } from '@/components/deck/deck-external-link-chip';
import { BracketBadge } from '@/components/deck/bracket-badge';
import { EdhrecDeckInsights, hasFreshEdhrecBadge, prefetchEdhrecStats } from '@/components/deck/edhrec-badge';
import { delay, runTasksWithConcurrency } from '@/lib/async-utils';
import { useProfileAccountCredentials } from '@/hooks/use-profile-account-credentials';
import { ProfileAccountPanel } from '@/components/profile/profile-account-panel';
import { useProfileDeckPersistence } from '@/hooks/use-profile-deck-persistence';
import { useProfileArchidektAutosync } from '@/hooks/use-profile-archidekt-autosync';
import { useProfileArchidektSettings } from '@/hooks/use-profile-archidekt-settings';
import { ProfileArchidektSettingsPanel } from '@/components/profile/profile-archidekt-settings-panel';
import { useProfileCommanderEditor } from '@/hooks/use-profile-commander-editor';
import { useProfileCommanderArts } from '@/hooks/use-profile-commander-arts';
import { useProfileArchidektImport } from '@/hooks/use-profile-archidekt-import';
import { useProfileUrlImport } from '@/hooks/use-profile-url-import';
import { useProfileManualDeck } from '@/hooks/use-profile-manual-deck';
import { useProfileDirectory } from '@/hooks/use-profile-directory';
import { ProfileNicknameDirectory } from '@/components/profile/profile-nickname-directory';
import type { ProfileDirectoryEntry as Profile } from '@/lib/types/profile-directory';
import { useProfileCatalog } from '@/hooks/use-profile-catalog';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';
import { useProfileMetadataEnrichment } from '@/hooks/use-profile-metadata-enrichment';
import { useProfileMetrics } from '@/hooks/use-profile-metrics';
import { MANA_COLOR_LABELS, MANA_COLOR_ORDER } from '@/lib/mana-colors';
import { getProfileDisplayName } from '@/lib/profile-display';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { ManaColorPills } from '@/components/ui/mana-color-pills';
import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  type DeckPerformanceStats,
} from '@/lib/deck-performance-analytics';
import { getDeckMastery, getHighestMasteryDeck } from '@/lib/deck-mastery';
import { ProfileDeckOverwriteDialog } from '@/components/profile/profile-deck-overwrite-dialog';
import {
  ArrowLeft,
  Plus,
  Trash2,
  ExternalLink,
  Swords,
  Trophy,
  Crown,
  Loader2,
  Search,
  User as UserIcon,
  RefreshCw,
  Save,
  X,
  Check,
  Image as ImageIcon,
  ChevronRight,
  Link2,
  Star,
  Archive,
  Download,
} from 'lucide-react';
import Link from 'next/link';
import { buildMatchRecord, formatMatchRecord } from '@/lib/win-rate';

type AddDeckMode = 'choose' | 'import-url' | 'archidekt-user' | 'manual';

function getProfileInitials(profile: Pick<Profile, 'username' | 'display_name'> | null | undefined) {
  const displayName = getProfileDisplayName(profile);
  if (!displayName) return '?';
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return displayName.slice(0, 2).toUpperCase();
}

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const fetchCommanderArts = useProfileCommanderArts();
  const { adminMode, loading:adminLoading } = usePlatformAdmin();
  const { decks, setDecks, loading, catalogError, loadCatalog } = useProfileCatalog(user, adminMode, adminLoading);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<AddDeckMode>('choose');
  const directory = useProfileDirectory(user, adminMode, adminLoading);
  const { profiles, setProfiles, fetchProfiles, saveProfileDisplayName } = directory;
  const currentProfile = user ? profiles.find((profile) => profile.id === user.id) || null : null;
  const [selectedTargetProfileId, setSelectedTargetProfileId] = useState<string>('');
  const [exportingAccount, setExportingAccount] = useState(false);
  const { scheduleEnrichment, commanderCmcSyncInProgress } =
    useProfileMetadataEnrichment(decks, setDecks, showAddModal, resolveCommanderColorOptions,
      user && !adminLoading ? user.id + ':' + adminMode : null);
  const {
    importDeckUrl, setImportDeckUrl, importingDeck, importedDeck, selectedImportedCommander,
    importedCommanderArts, loadingImportedCommanderArts,
    handleUrlImport, resetUrlImport, selectImportedCommander, selectImportedArt,
  } = useProfileUrlImport(user && !adminLoading ? user.id + ':' + adminMode : null,
    showAddModal && addMode === 'import-url', fetchCommanderArts);
  const {
    archidektUsername, setArchidektUsername, importingUserDecks,
    importedUserDecks, selectedUserDeckCommanders, setSelectedUserDeckCommanders,
    selectedUserDeckUrls, setSelectedUserDeckUrls, handleArchidektUserImport,
    clearArchidektPreview, resetArchidektImport,
  } = useProfileArchidektImport(user && !adminLoading ? user.id + ':' + adminMode : null,
    showAddModal && addMode === 'archidekt-user', currentProfile?.archidekt_username || '');
  const archidektSettings = useProfileArchidektSettings(user && !adminLoading ? user.id + ':' + adminMode : null,
    user?.id ?? null, currentProfile, setProfiles);
  const {
    selectedCommander, setSelectedCommander, selectedPartnerCommander, setSelectedPartnerCommander,
    searchQuery, setSearchQuery, searchResults, setSearchResults, searching,
    partnerSearchQuery, setPartnerSearchQuery, partnerSearchResults, setPartnerSearchResults, searchingPartner,
    manualCommanderArts, setManualCommanderArts, loadingManualCommanderArts, setLoadingManualCommanderArts,
    customDeckName, setCustomDeckName, manualPartnerMode, manualPartnerCopy, handleSelectCommander,
    freezeManualSelection,
  } = useProfileManualDeck(
    user && !adminLoading ? user.id + ':' + adminMode : null,
    showAddModal && addMode === 'manual', fetchCommanderArts);
  const [refreshingDecks, setRefreshingDecks] = useState(false);
  const [refreshingDeckIds, setRefreshingDeckIds] = useState<string[]>([]);
  const {
    editingArtDeck, deckCommanderOptions, selectedDeckCommander, deckArtOptions,
    loadingDeckArtOptions, savingDeckArt, openDeckArtEditor, selectDeckCommander,
    saveDeckCommanderPresentation, closeCommanderEditor,
  } = useProfileCommanderEditor(user && !adminLoading ? user.id + ':' + adminMode : null,
    fetchCommanderArts, setDecks);
  const [linkingDeck, setLinkingDeck] = useState<Deck | null>(null);
  const [linkDeckUrl, setLinkDeckUrl] = useState('');
  const [savingDeckLink, setSavingDeckLink] = useState(false);
  const [deckSearchQuery, setDeckSearchQuery] = useState('');
  const [deckColorFilter, setDeckColorFilter] = useState<string[]>([]);
  const [deckPlayerFilter, setDeckPlayerFilter] = useState('all');
  const { deckWinRates, deckPerformance, metricsLoading, metricsError, refreshMetrics } = useProfileMetrics(adminLoading ? undefined : user?.id, adminMode, decks);
  const [deckSort, setDeckSort] = useState<'recent' | 'winRate' | 'gamesPlayed' | 'damage' | 'eliminations' | 'fastest'>('recent');
  const [detailsDeck, setDetailsDeck] = useState<Deck | null>(null);
  const targetProfiles = profiles.filter((profile) => !RESERVED_USERNAMES.has(profile.username.toLowerCase()));

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!adminMode || selectedTargetProfileId || targetProfiles.length === 0) return;
    const firstPlayer = targetProfiles.find((profile) => profile.id !== user?.id) || targetProfiles[0];
    setSelectedTargetProfileId(firstPlayer.id);
  }, [adminMode, targetProfiles, selectedTargetProfileId, user?.id]);


  const fetchDecks = useCallback(async () => {
    const loaded = await loadCatalog();
    if (!loaded) return;
    scheduleEnrichment(loaded.decks, loaded.signal);
  }, [loadCatalog, scheduleEnrichment]);

  const visibleDecks = useMemo(() => {
    const activeDecks = decks.filter((deck) => !deck.is_archived);
    if (!adminMode || deckPlayerFilter === 'all') {
      return activeDecks;
    }

    return activeDecks.filter((deck) => deck.user_id === deckPlayerFilter);
  }, [adminMode, deckPlayerFilter, decks]);

  const archivedDecks = useMemo(() => decks.filter((deck) => deck.is_archived && deck.user_id === user?.id), [decks, user?.id]);

  const setDeckArchived = useCallback(async (deck: Deck, archived: boolean) => {
    if (!user || deck.user_id !== user.id || deck.group_id !== null) return;
    const { error } = await supabase.from('decks').update({ is_archived: archived })
      .eq('id', deck.id).eq('user_id', user.id).is('group_id', null);
    if (error) throw error;
    setDecks((current) => current.map((entry) => entry.id === deck.id ? { ...entry, is_archived: archived } : entry));
    toast({ title: t(archived ? { it: 'Mazzo archiviato', en: 'Deck archived' } : { it: 'Mazzo ripristinato', en: 'Deck restored' }) });
  }, [setDecks, t, toast, user]);

  const filteredDecks = useMemo(() => {
    const normalizedQuery = deckSearchQuery.trim().toLowerCase();

    const matching = visibleDecks.filter((deck) => {
      if (deckColorFilter.length) {
        const colors = getDeckDisplayColors(deck);
        if (!deckColorFilter.every((color) => colors.includes(color))) {
          return false;
        }
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = `${deck.name} ${deck.commander}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    return matching.sort((left, right) => {
      const favoriteOrder = Number(right.is_favorite) - Number(left.is_favorite);
      if (favoriteOrder !== 0) return favoriteOrder;
      const a = deckPerformance.get(left.id);
      const b = deckPerformance.get(right.id);
      if (deckSort === 'winRate') return (b?.winRate || 0) - (a?.winRate || 0) || (b?.gamesPlayed || 0) - (a?.gamesPlayed || 0);
      if (deckSort === 'gamesPlayed') return (b?.gamesPlayed || 0) - (a?.gamesPlayed || 0);
      if (deckSort === 'damage') return (b?.totalDamageDealt || 0) - (a?.totalDamageDealt || 0);
      if (deckSort === 'eliminations') return (b?.eliminations || 0) - (a?.eliminations || 0);
      if (deckSort === 'fastest') {
        return (a?.medianWinningDurationSeconds ?? Number.MAX_SAFE_INTEGER)
          - (b?.medianWinningDurationSeconds ?? Number.MAX_SAFE_INTEGER);
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
  }, [deckColorFilter, deckPerformance, deckSearchQuery, deckSort, visibleDecks]);

  const personalSnapshot = useMemo(() => {
    const performances = visibleDecks.map((deck) => deckPerformance.get(deck.id)).filter((entry): entry is DeckPerformanceStats => Boolean(entry));
    const games = performances.reduce((total, entry) => total + entry.gamesPlayed, 0);
    const wins = performances.reduce((total, entry) => total + entry.wins, 0);
    const favorite = getHighestMasteryDeck(visibleDecks, (deck) => deckPerformance.get(deck.id));
    const mostPlayed = [...visibleDecks].sort((a, b) => (deckPerformance.get(b.id)?.gamesPlayed || 0) - (deckPerformance.get(a.id)?.gamesPlayed || 0))[0];
    const draws=performances.reduce((total,entry)=>total+entry.draws,0);
    return { games, wins, winRate: buildMatchRecord({gamesPlayed:games,wins,draws}).winRate, favorite, mostPlayed };
  }, [deckPerformance, visibleDecks]);

  const toggleDeckFavorite = useCallback(async (deck: Deck) => {
    if (!user || deck.user_id !== user.id) return;
    const next = !deck.is_favorite;
    setDecks((current) => current.map((entry) => entry.id === deck.id ? { ...entry, is_favorite: next } : entry));
    const { error } = await supabase
      .from('decks')
      .update({ is_favorite: next })
      .eq('id', deck.id)
      .eq('user_id', user.id);
    if (error) {
      setDecks((current) => current.map((entry) => entry.id === deck.id ? { ...entry, is_favorite: !next } : entry));
      toast({
        title: t({ it: 'Preferito non aggiornato', en: 'Favorite not updated' }),
        variant: 'destructive',
      });
    }
  }, [setDecks, t, toast, user]);

  useEffect(() => {
    if (user) {
      fetchDecks();
      fetchProfiles();
    }
  }, [user, fetchDecks, fetchProfiles]);

  const getTargetProfileId = () => {
    if (!user) return null;
    return adminMode ? selectedTargetProfileId || null : user.id;
  };

  const getTargetProfileName = () => {
    if (!adminMode) return null;
    return getProfileDisplayName(profiles.find((profile) => profile.id === selectedTargetProfileId));
  };

  const account = useProfileAccountCredentials(user, currentProfile, saveProfileDisplayName);

  const exportAccountData = async () => {
    setExportingAccount(true);
    try {
      const response = await authenticatedFetch('/api/auth/export-account');
      if (!response.ok) throw new Error(t({ it: 'Export non riuscito.', en: 'Export failed.' }));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mtg-tracker-account-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: t({ it: 'Dati account esportati', en: 'Account data exported' }) });
    } catch (error) {
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setExportingAccount(false);
    }
  };

  const refreshImportedDeck = async (deck: Deck) => {
    if (deck.source_type === 'manual' || !deck.source_url) return null;

    const response = await authenticatedFetch('/api/deck-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: deck.source_url, fresh: true }),
    });

    if (!response.ok) return null;

    const imported = await response.json() as ImportedDeckPreview;
    const importedCommanderOptions = imported.commanderOptions || [];
    const currentCommanderStillAvailable = importedCommanderOptions.some((option) =>
      option.name.toLowerCase() === deck.commander.toLowerCase()
    );
    const refreshedCommander = currentCommanderStillAvailable
      ? deck.commander
      : imported.commander || deck.commander;
    const refreshedCommanderOption = importedCommanderOptions.find((option) =>
      option.name.toLowerCase() === refreshedCommander.toLowerCase()
    );
    const colorFields = deckDataToColorFields({
      commanderOptions: importedCommanderOptions,
      colorIdentity: imported.colorIdentity || [],
    });
    const commanderCmc = await resolveDeckCommanderCmc(
      {
        commander: refreshedCommander,
        commander_options: colorFields.commander_options,
      },
      lookupCommanderCmcInBrowser,
    );
    const refreshedDeck = {
      name: imported.name || deck.name,
      commander: refreshedCommander,
      commander_image: currentCommanderStillAvailable
        ? deck.commander_image || refreshedCommanderOption?.imageUrl || imported.commanderImageUrl || null
        : refreshedCommanderOption?.imageUrl || imported.commanderImageUrl || deck.commander_image,
      bracket: typeof imported.bracket === 'string' ? imported.bracket : null,
      commander_cmc: commanderCmc ?? deck.commander_cmc,
      ...colorFields,
    };

    const { error } = await supabase
      .from('decks')
      .update(refreshedDeck)
      .eq('id', deck.id);

    if (error) return null;
    return { id: deck.id, ...refreshedDeck };
  };

  const handleRefreshImportedDeck = async (deck: Deck) => {
    setRefreshingDeckIds((ids) => [...ids, deck.id]);
    try {
      const update = await refreshImportedDeck(deck);
      if (!update) {
        toast({
          title: t({ it: 'Mazzo non aggiornato', en: 'Deck not refreshed' }),
          description: t({ it: 'La fonte non ha restituito dati aggiornati.', en: 'The source did not return updated data.' }),
        });
        return;
      }

      setDecks((currentDecks) => currentDecks.map((currentDeck) =>
        currentDeck.id === deck.id ? { ...currentDeck, ...update } : currentDeck
      ));
      toast({
        title: t({ it: 'Mazzo aggiornato', en: 'Deck refreshed' }),
        description: update.name,
      });
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Aggiornamento mazzo non riuscito', en: 'Failed to refresh deck' }),
        variant: 'destructive',
      });
    } finally {
      setRefreshingDeckIds((ids) => ids.filter((id) => id !== deck.id));
    }
  };

  const handleLinkDeckToExternalSource = async () => {
    if (!linkingDeck || !linkDeckUrl.trim()) return;
    setSavingDeckLink(true);
    try {
      const response = await authenticatedFetch('/api/deck-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkDeckUrl }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || t({ it: 'Link non valido.', en: 'Invalid link.' }));
      }

      const imported = await response.json() as ImportedDeckPreview;
      if (!isImportedDeckSource(imported.sourceType) || !imported.sourceUrl) {
        throw new Error(t({ it: 'Sono supportati solo Archidekt e Moxfield.', en: 'Only Archidekt and Moxfield are supported.' }));
      }
      const duplicate = decks.find((deck) =>
        deck.id !== linkingDeck.id
        && deck.user_id === linkingDeck.user_id
        && deck.source_url === imported.sourceUrl,
      );
      if (duplicate) {
        throw new Error(t({ it: 'Questa lista e gia collegata a un altro tuo mazzo.', en: 'This list is already linked to another one of your decks.' }));
      }

      const colorFields = deckDataToColorFields({
        commanderOptions: imported.commanderOptions || [],
        colorIdentity: imported.colorIdentity || [],
      });
      const commanderCmc = await resolveDeckCommanderCmc(
        { commander: linkingDeck.commander, commander_options: colorFields.commander_options },
        lookupCommanderCmcInBrowser,
      );
      const update = {
        source_url: imported.sourceUrl,
        source_type: imported.sourceType,
        bracket: imported.bracket,
        commander_cmc: commanderCmc ?? linkingDeck.commander_cmc,
        ...colorFields,
      };
      const { error } = await supabase.from('decks').update(update).eq('id', linkingDeck.id);
      if (error) throw error;

      setDecks((current) => current.map((deck) => deck.id === linkingDeck.id ? { ...deck, ...update } : deck));
      setLinkingDeck(null);
      setLinkDeckUrl('');
      toast({
        title: t({ it: 'Lista collegata', en: 'List linked' }),
        description: t({ it: 'Il mazzo manterra comandante e nome; da ora puo aggiornarsi dalla sorgente.', en: 'The deck keeps its commander and name; it can now refresh from its source.' }),
      });
    } catch (error) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile collegare la lista.', en: 'Unable to link the list.' })),
        variant: 'destructive',
      });
    } finally {
      setSavingDeckLink(false);
    }
  };

  const deckNeedsRefreshWork = useCallback((deck: Deck) => {
    const needsImportRefresh = isImportedDeckSource(deck.source_type) && Boolean(deck.source_url);
    const needsEdhrecRefresh = Boolean(deck.commander?.trim()) && !hasFreshEdhrecBadge(deck.commander);
    return needsImportRefresh || needsEdhrecRefresh;
  }, []);

  const consumeDeckRefreshBudget = useCallback(async () => {
    const response = await fetch('/api/profile/deck-refresh-budget', { method: 'POST' });
    return response.ok;
  }, []);

  const handleRefreshDecks = async () => {
    const decksToRefresh = visibleDecks.filter(deckNeedsRefreshWork);
    if (decksToRefresh.length === 0) {
      toast({
        title: t({ it: 'Nessun aggiornamento necessario', en: 'No refresh needed' }),
        description: t({
          it: 'Tutti i mazzi visibili hanno già dati import e badge EDHREC aggiornati.',
          en: 'All visible decks already have up-to-date import data and EDHREC badges.',
        }),
      });
      return;
    }

    setRefreshingDecks(true);
    setRefreshingDeckIds(decksToRefresh.map((deck) => deck.id));

    let importedUpdates = 0;
    let edhrecUpdates = 0;
    let rateLimited = false;

    try {
      const results = await runTasksWithConcurrency(decksToRefresh, 2, async (deck) => {
        const hasBudget = await consumeDeckRefreshBudget();
        if (!hasBudget) {
          rateLimited = true;
          return null;
        }

        let commander = deck.commander;
        let deckUpdate: Awaited<ReturnType<typeof refreshImportedDeck>> = null;
        let edhrecRefreshed = false;

        if (isImportedDeckSource(deck.source_type) && deck.source_url) {
          deckUpdate = await refreshImportedDeck(deck);
          if (deckUpdate?.commander) {
            commander = deckUpdate.commander;
          }
        }

        if (commander?.trim() && !hasFreshEdhrecBadge(commander)) {
          const stats = await prefetchEdhrecStats(commander);
          if (stats) {
            edhrecRefreshed = true;
          }
        }

        return {
          deckId: deck.id,
          update: deckUpdate,
          imported: Boolean(deckUpdate),
          edhrecRefreshed,
        };
      });

      const successfulResults = results.filter((result): result is NonNullable<typeof result> => Boolean(result));
      const successfulUpdates = successfulResults
        .map((result) => result.update)
        .filter((update): update is NonNullable<typeof update> => Boolean(update));

      importedUpdates = successfulResults.filter((result) => result.imported).length;
      edhrecUpdates = successfulResults.filter((result) => result.edhrecRefreshed).length;

      if (successfulUpdates.length > 0) {
        setDecks((currentDecks) => currentDecks.map((deck) => {
          const update = successfulUpdates.find((item) => item.id === deck.id);
          return update ? { ...deck, ...update } : deck;
        }));
      }

      if (importedUpdates === 0 && edhrecUpdates === 0) {
        toast({
          title: t({ it: 'Nessun mazzo aggiornato', en: 'No decks updated' }),
          description: rateLimited
            ? t({
              it: 'Limite raggiunto: massimo 200 mazzi ogni 10 minuti.',
              en: 'Rate limit reached: maximum 200 decks every 10 minutes.',
            })
            : t({ it: 'Le fonti non hanno restituito nuovi dati.', en: 'The sources did not return updated data.' }),
          variant: rateLimited ? 'destructive' : 'default',
        });
        return;
      }

      toast({
        title: t({ it: 'Aggiornamento completato', en: 'Refresh completed' }),
        description: t({
          it: `${importedUpdates} import, ${edhrecUpdates} EDHREC${rateLimited ? ' · limite 200/10 min raggiunto per i restanti' : ''}`,
          en: `${importedUpdates} imports, ${edhrecUpdates} EDHREC${rateLimited ? ' · 200/10 min limit reached for remaining decks' : ''}`,
        }),
      });
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Aggiornamento mazzi non riuscito', en: 'Failed to refresh decks' }),
        variant: 'destructive',
      });
    } finally {
      setRefreshingDecks(false);
      setRefreshingDeckIds([]);
    }
  };
  const closeAddModal = () => {
    setShowAddModal(false);
    setAddMode('choose');
    resetUrlImport();
    resetArchidektImport();
    setSearchQuery('');
    setSearchResults([]);
    setSelectedCommander(null);
    setPartnerSearchQuery('');
    setPartnerSearchResults([]);
    setSelectedPartnerCommander(null);
    setManualCommanderArts([]);
    setLoadingManualCommanderArts(false);
    setCustomDeckName('');
  };
  const { savingDeck, savingUserDecks, overwriteConfirm, closeOverwriteConfirm,
    saveArchidektDeck, saveArchidektUserDecks, saveManualDeck } = useProfileDeckPersistence({
    scopeKey: user && !adminLoading ? user.id + ':' + adminMode : null, open: showAddModal, mode: addMode,
    user, adminMode, decks, getTargetProfileId, getTargetProfileName, importedDeck, selectedImportedCommander,
    importedUserDecks, selectedUserDeckUrls, selectedUserDeckCommanders, selectedCommander,
    selectedPartnerCommander, customDeckName, closeAddModal, fetchDecks, freezeManualSelection,
  });

  useProfileArchidektAutosync(user && !adminLoading ? user.id + ':' + adminMode : null,
    user?.id ?? null, currentProfile, fetchDecks);

  const handleDeleteDeck = async (deckId: string, deckName: string) => {
    if (!confirm(t({
      it: `Eliminare "${deckName}"?`,
      en: `Are you sure you want to delete "${deckName}"?`,
    }))) return;

    try {
      const { error } = await supabase.from('decks').delete().eq('id', deckId);
      if (error) throw error;

      toast({ title: t({ it: 'Mazzo eliminato', en: 'Deck deleted' }) });
      fetchDecks();
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error ? error.message : t({ it: 'Eliminazione mazzo non riuscita', en: 'Failed to delete deck' }),
        variant: 'destructive',
      });
    }
  };

  const getSourceBadge = (sourceType: string | null) => {
    if (sourceType === 'archidekt') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
          Archidekt
        </span>
      );
    }
    if (sourceType === 'moxfield') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/20 px-2 py-0.5 text-xs text-teal-300">
          Moxfield
        </span>
      );
    }
    return null;
  };

  const getSourceLinkLabel = (sourceType: string | null) => {
    if (sourceType === 'moxfield') return t({ it: 'Vedi su Moxfield', en: 'View on Moxfield' });
    if (sourceType === 'archidekt') return t({ it: 'Vedi su Archidekt', en: 'View on Archidekt' });
    return t({ it: 'Vedi sorgente', en: 'View source' });
  };

  const getDeckWinRateBadge = (deckId: string) => {
    const stats = deckWinRates.get(deckId);
    if (!stats || stats.gamesPlayed === 0) return null;

    return (
      <span
        title={t({
          it: `${stats.wins} vittorie su ${stats.gamesPlayed} partite`,
          en: `${stats.wins} wins in ${stats.gamesPlayed} games`,
        })}
        className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200"
      >
        <Trophy className="h-3 w-3" />
        {stats.winRate}%
        <span className="opacity-75">· {formatMatchRecord(stats)}</span>
      </span>
    );
  };

  const renderCommanderArtPicker = (
    arts: CommanderArtOption[],
    selectedImageUrl: string | null | undefined,
    onSelect: (art: CommanderArtOption) => void,
    loadingArts: boolean
  ) => (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">
        {t({ it: 'Scegli art comandante', en: 'Choose commander art' })}
      </p>
      {loadingArts ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background/35 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t({ it: 'Caricamento art...', en: 'Loading arts...' })}
        </div>
      ) : arts.length > 0 ? (
        <div className="overflow-x-auto pb-2">
          <div className="grid grid-flow-col auto-cols-[132px] gap-3">
            {arts.map((art) => {
              const selected = selectedImageUrl === art.imageUrl;
              return (
                <button
                  key={`${art.id}-${art.imageUrl}`}
                  type="button"
                  onClick={() => onSelect(art)}
                  className={`rounded-lg border p-2 text-left transition-colors ${
                    selected ? 'border-emerald-500 bg-emerald-500/10' : 'border-border bg-background/25 hover:border-emerald-500/50'
                  }`} disabled={savingDeck || savingUserDecks}
                >
                  <DeckImage
                    src={art.imageUrl}
                    alt={art.name}
                    className="h-24 w-full rounded object-cover object-top"
                  />
                  <p className="mt-2 truncate text-xs font-medium text-foreground">
                    {art.setName || t({ it: 'Stampa', en: 'Printing' })}
                  </p>
                  {(art.collectorNumber || art.releasedAt) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {[art.collectorNumber, art.releasedAt].filter(Boolean).join(' - ')}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
          {t({ it: 'Nessuna art alternativa trovata su Scryfall.', en: 'No alternate art found on Scryfall.' })}
        </p>
      )}
    </div>
  );

  if (authLoading || loading) {
    return <AppLoader label={t({ it: 'Caricamento profilo...', en: 'Loading profile...' })} />;
  }

  if (!user) return null;

  return (
    <div className="web-page min-h-screen">
      <header className="web-header phyrexian-divider safe-top sticky top-0 z-10 border-b">
        <div className="web-container mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/dashboard')}
              aria-label={t({ it: 'Torna alla home', en: 'Back to home' })}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <ManaLogo size="sm" showText />
          </div>
          <AppProfileButton />
        </div>
      </header>

      <main className="web-container mx-auto max-w-[92rem] px-3 py-5 sm:px-4 sm:py-8">
        {/* Profile Info */}
        {catalogError ? <div role="alert" className="mb-4 rounded-xl border border-amber-400/30 p-4"><p>{t({it:'Catalogo non disponibile. Riprova.',en:'Catalog unavailable. Please retry.'})}</p><Button onClick={()=>void fetchDecks()}>{t({it:'Riprova',en:'Retry'})}</Button></div> : null}
        {metricsError ? <div role="alert" className="mb-4 rounded-xl border border-amber-400/30 p-4"><p>{t({ it: 'Statistiche non disponibili. Nessun dato parziale viene mostrato.', en: 'Statistics unavailable. Partial data is not displayed.' })}</p><Button onClick={refreshMetrics}>{t({ it: 'Riprova', en: 'Retry' })}</Button></div> : null}
        <MotionPanel>
          <ProfileAccountPanel user={user} currentProfile={currentProfile} adminMode={adminMode} controls={account}>
              <ProfileArchidektSettingsPanel controls={archidektSettings} />
          </ProfileAccountPanel>
        </MotionPanel>

        {adminMode && <ProfileNicknameDirectory directory={directory} />}

        {!adminMode && !catalogError && (
          <section className="web-player-card mb-8 overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-950/45 via-background to-violet-950/35 p-4 shadow-[0_16px_42px_rgba(6,182,212,0.08)] sm:p-5" aria-label={t({ it: 'La tua scheda giocatore', en: 'Your player card' })}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/70">{t({ it: 'Scheda giocatore', en: 'Player card' })}</p><h2 className="mt-1 text-xl font-bold text-foreground">{t({ it: 'La tua Command Zone', en: 'Your Command Zone' })}</h2></div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/25 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-100"><Crown className="h-3.5 w-3.5 text-violet-300" />{personalSnapshot.games ? t({ it: 'Statistiche personali', en: 'Personal stats' }) : t({ it: 'Pronto a giocare', en: 'Ready to play' })}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: t({ it: 'Partite giocate', en: 'Matches played' }), value: metricsLoading || metricsError ? '—' : personalSnapshot.games, tone: 'from-cyan-500/20 to-cyan-950/10', icon: Swords },
                { label: t({ it: 'Win rate', en: 'Win rate' }), value: metricsLoading || metricsError ? '—' : `${personalSnapshot.winRate}%`, tone: 'from-emerald-500/20 to-emerald-950/10', icon: Trophy },
                { label: t({ it: 'Mazzi attivi', en: 'Active decks' }), value: visibleDecks.length, tone: 'from-violet-500/20 to-violet-950/10', icon: Star },
              ].map(({ label, value, tone, icon: Icon }) => <div key={label} className={`rounded-xl border border-white/10 bg-gradient-to-br ${tone} p-3`}><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{label}</span><Icon className="h-4 w-4 text-white/70" /></div><p className="mt-2 text-2xl font-bold text-foreground">{value}</p></div>)}
            </div>
            {!metricsLoading && !metricsError && (personalSnapshot.favorite || personalSnapshot.mostPlayed) ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-amber-300/15 bg-amber-500/5 p-3"><p className="text-xs text-amber-200/70">{t({ it: 'Mazzo preferito', en: 'Favorite deck' })}</p><p className="mt-1 truncate font-semibold text-foreground">{personalSnapshot.favorite?.name || '—'}</p></div><div className="rounded-xl border border-cyan-300/15 bg-cyan-500/5 p-3"><p className="text-xs text-cyan-200/70">{t({ it: 'Più giocato', en: 'Most played' })}</p><p className="mt-1 truncate font-semibold text-foreground">{personalSnapshot.mostPlayed?.name || '—'}</p></div></div> : null}
          </section>
        )}

        {/* Decks Section */}
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border/70 bg-black/25 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-foreground">{t({ it: 'Arsenale mazzi', en: 'Deck Arsenal' })}</h2>
            <p className="text-sm text-muted-foreground">
              {filteredDecks.length}
              {filteredDecks.length !== visibleDecks.length
                ? ` / ${visibleDecks.length}`
                : ''}{' '}
              {t({
                it: visibleDecks.length === 1 ? 'mazzo nella collezione' : 'mazzi nella collezione',
                en: visibleDecks.length === 1 ? 'deck in your collection' : 'decks in your collection',
              })}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:flex gap-2">
            {user ? <Button asChild variant="outline" className="border-border text-foreground"><Link href="/profile/archived-decks"><Archive className="mr-2 h-4 w-4" />{t({ it: `Archiviati (${archivedDecks.length})`, en: `Archived (${archivedDecks.length})` })}</Link></Button> : null}
            <Button
              variant="outline"
              onClick={handleRefreshDecks}
              disabled={refreshingDecks || !visibleDecks.some(deckNeedsRefreshWork)}
              className="border-border text-foreground"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshingDecks ? 'animate-spin' : ''}`} />
              {t({ it: 'Aggiorna mazzi', en: 'Refresh Decks' })}
            </Button>
            <Button
              onClick={() => setShowAddModal(true)}
              className="bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800"
            >
              <Plus className="w-4 h-4 mr-2" />
              {t({ it: 'Aggiungi mazzo', en: 'Add Deck' })}
            </Button>
          </div>
        </div>

        {visibleDecks.length > 0 && (
          <div className="mb-6 grid gap-3 rounded-lg border border-border/70 bg-black/20 p-3 md:grid-cols-2 xl:grid-cols-4">
            {adminMode && (
              <Select
                value={deckPlayerFilter}
                onValueChange={setDeckPlayerFilter}
                disabled={targetProfiles.length === 0}
              >
                <SelectTrigger className="border-border bg-background/50 text-foreground md:col-span-2 xl:col-span-1">
                  <SelectValue placeholder={t({ it: 'Filtra per giocatore', en: 'Filter by player' })} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t({ it: 'Tutti i giocatori', en: 'All players' })}
                  </SelectItem>
                  {targetProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {getProfileDisplayName(profile)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={deckSearchQuery}
                onChange={(event) => setDeckSearchQuery(event.target.value)}
                placeholder={t({ it: 'Cerca per nome o comandante...', en: 'Search by name or commander...' })}
                className="border-border bg-background/50 pl-9 text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex min-h-10 items-center gap-1 rounded-md border border-border bg-background/50 px-2" aria-label={t({ it: 'Filtra per colori', en: 'Filter by colors' })}>
              <button type="button" onClick={() => setDeckColorFilter([])} className={`rounded px-1.5 py-1 text-xs font-bold ${deckColorFilter.length === 0 ? 'bg-emerald-500/20 text-emerald-200' : 'text-muted-foreground'}`}>{t({ it: 'Tutti', en: 'All' })}</button>
              {MANA_COLOR_ORDER.map((color) => <button key={color} type="button" onClick={() => setDeckColorFilter((current) => current.includes(color) ? current.filter((item) => item !== color) : [...current, color])} className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black ${deckColorFilter.includes(color) ? 'bg-emerald-400 text-emerald-950' : 'bg-secondary text-muted-foreground'}`} title={t(MANA_COLOR_LABELS[color])}>{color}</button>)}
            </div>
            <Select value={deckSort} onValueChange={(value) => setDeckSort(value as typeof deckSort)}>
              <SelectTrigger aria-label={t({ it: 'Ordina mazzi', en: 'Sort decks' })} className="border-border bg-background/50 text-foreground">
                <SelectValue placeholder={t({ it: 'Ordina per', en: 'Sort by' })} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">{t({ it: 'Aggiunti di recente', en: 'Recently added' })}</SelectItem>
                <SelectItem value="winRate">Win rate</SelectItem>
                <SelectItem value="gamesPlayed">{t({ it: 'Partite giocate', en: 'Games played' })}</SelectItem>
                <SelectItem value="damage">{t({ it: 'Danni inflitti', en: 'Damage dealt' })}</SelectItem>
                <SelectItem value="eliminations">KO</SelectItem>
                <SelectItem value="fastest">{t({ it: 'Vittoria più veloce', en: 'Fastest win' })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {filteredDecks.length > 0 ? (
          <DeckCollectionInsights
            decks={filteredDecks}
            commanderCmcSyncInProgress={commanderCmcSyncInProgress}
          />
        ) : null}

        {catalogError ? null : visibleDecks.length === 0 ? (
          <Card className="phyrexian-panel">
            <CardContent className="py-12 text-center">
              {adminMode && deckPlayerFilter !== 'all' && decks.length > 0 ? (
                <>
                  <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                  <h3 className="mb-2 text-lg font-medium text-foreground">
                    {t({ it: 'Nessun mazzo per questo giocatore', en: 'No decks for this player' })}
                  </h3>
                  <p className="text-muted-foreground">
                    {t({ it: 'Prova a selezionare un altro giocatore dal filtro.', en: 'Try selecting another player from the filter.' })}
                  </p>
                </>
              ) : (
                <>
                  <Swords className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">{t({ it: 'Nessun mazzo', en: 'No decks yet' })}</h3>
                  <p className="text-muted-foreground mb-4">
                    {t({ it: 'Aggiungi il primo mazzo per iniziare a tracciare le partite', en: 'Add your first deck to start tracking battles' })}
                  </p>
                  <Button
                    onClick={() => setShowAddModal(true)}
                    className="bg-gradient-to-r from-emerald-600 to-teal-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {t({ it: 'Aggiungi il primo mazzo', en: 'Add Your First Deck' })}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        ) : filteredDecks.length === 0 ? (
          <Card className="phyrexian-panel">
            <CardContent className="py-10 text-center">
              <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-medium text-foreground">
                {t({ it: 'Nessun mazzo trovato', en: 'No decks found' })}
              </h3>
              <p className="text-muted-foreground">
                {t({ it: 'Prova a cambiare ricerca o filtro colore.', en: 'Try changing your search or color filter.' })}
              </p>
            </CardContent>
          </Card>
        ) : (
          <MotionList className="web-deck-grid space-y-3 sm:space-y-4">
            {filteredDecks.map((deck) => {
              const performance = deckPerformance.get(deck.id);
              const gamesPlayed = performance?.gamesPlayed ?? 0;
              const wins = performance?.wins ?? 0;
              const mastery = getDeckMastery(gamesPlayed, wins);

              return (
                <MotionItem key={deck.id}>
                  <Card
                    className="phyrexian-panel group relative min-h-[15rem] cursor-pointer overflow-hidden border-2 transition-[border-color,box-shadow] hover:brightness-110"
                    style={gamesPlayed > 0 ? {
                      borderColor: mastery.color,
                      boxShadow: `0 0 24px ${mastery.color}26`,
                    } : undefined}
                    onClick={() => setDetailsDeck(deck)}
                  >
                    <DeckImage
                      src={deck.commander_image}
                      alt={deck.commander}
                      className="absolute inset-0 h-full w-full rounded-none object-cover object-top"
                      fallbackClassName="absolute inset-0 h-full w-full rounded-none"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/90 via-black/65 to-black/45" />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/35" />

                    <CardContent className="relative flex min-h-[15rem] flex-col gap-4 p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="line-clamp-2 text-lg font-black leading-tight text-white sm:text-xl">
                            {deck.name}
                          </h3>
                          <p className="mt-1 line-clamp-2 text-sm font-semibold text-white/75">{deck.commander}</p>
                        </div>
                        <ManaColorPills colors={getDeckDisplayColors(deck)} size="xs" gap="tight" className="shrink-0" />
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {getSourceBadge(deck.source_type)}
                        <BracketBadge bracket={deck.bracket} className="rounded-full border border-emerald-500/30 px-2" />
                        {getDeckWinRateBadge(deck.id)}
                        {adminMode && deck.profiles?.username ? (
                          <span className="rounded-full border border-white/15 bg-black/35 px-2 py-1 text-[10px] text-white/70">
                            {getProfileDisplayName(deck.profiles)}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                        {deck.source_url ? (
                          <DeckExternalLinkChip
                            href={deck.source_url}
                            label={getSourceLinkLabel(deck.source_type)}
                            tone={deck.source_type === 'moxfield' ? 'blue' : deck.source_type === 'archidekt' ? 'teal' : 'emerald'}
                          />
                        ) : null}
                        <EdhrecDeckInsights
                          commander={deck.commander}
                          localBracket={deck.bracket}
                          showBadge={false}
                          showBracketComparison={false}
                          linkVariant="chip"
                        />
                      </div>

                      <div className="web-deck-footer mt-auto flex flex-col gap-3 lg:flex-row lg:items-end">
                        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-7">
                          {!metricsLoading && !metricsError ? <DeckMasteryBadge gamesPlayed={gamesPlayed} wins={wins} /> : null}
                          <div className="min-w-[4.75rem] text-center">
                            <p className="text-2xl font-black text-white">{performance?.winRate ?? 0}%</p>
                            <p className="text-xs text-white/60">Win rate</p>
                          </div>
                        </div>

                        <div
                          className="flex flex-wrap items-center justify-end gap-1 rounded-xl border border-white/10 bg-black/50 p-1"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {deck.user_id === user?.id ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-pressed={deck.is_favorite}
                              className={`h-11 w-11 ${deck.is_favorite ? 'text-amber-300 hover:text-amber-200' : 'text-white/60 hover:text-amber-300'}`}
                              onClick={() => void toggleDeckFavorite(deck)}
                              title={t({
                                it: deck.is_favorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti',
                                en: deck.is_favorite ? 'Remove from favorites' : 'Add to favorites',
                              })}
                            >
                              <Star className={`h-4 w-4 ${deck.is_favorite ? 'fill-current' : ''}`} />
                            </Button>
                          ) : null}
                          {deck.user_id === user?.id ? (
                            <Button variant="ghost" size="icon" className="h-11 w-11 text-white/60 hover:text-emerald-300" onClick={() => void setDeckArchived(deck, true).catch((error) => toast({ title: t({ it: 'Errore', en: 'Error' }), description: getSupabaseErrorMessage(error, t({ it: 'Archiviazione non riuscita', en: 'Failed to archive deck' })), variant: 'destructive' }))} title={t({ it: 'Archivia mazzo', en: 'Archive deck' })}>
                              <Archive className="h-4 w-4" />
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="sm" className="min-h-11 gap-1 px-3 text-emerald-200" onClick={() => setDetailsDeck(deck)}>
                            {t({ it: 'Dettagli', en: 'Details' })} <ChevronRight className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 text-white/60 hover:text-emerald-300"
                            onClick={() => {
                              setLinkingDeck(deck);
                              setLinkDeckUrl(deck.source_url || '');
                            }}
                            title={t({ it: 'Collega lista Archidekt o Moxfield', en: 'Link an Archidekt or Moxfield list' })}
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>
                          {isImportedDeckSource(deck.source_type) && deck.source_url ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-11 w-11 text-white/60 hover:text-emerald-300"
                              onClick={() => handleRefreshImportedDeck(deck)}
                              disabled={refreshingDeckIds.includes(deck.id)}
                              title={t({ it: 'Aggiorna da sorgente', en: 'Refresh from source' })}
                            >
                              <RefreshCw className={`h-4 w-4 ${refreshingDeckIds.includes(deck.id) ? 'animate-spin' : ''}`} />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 text-white/60 hover:text-white"
                            onClick={() => openDeckArtEditor(deck)}
                            title={t({ it: 'Modifica comandante', en: 'Edit commander' })}
                          >
                            <ImageIcon className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 text-white/60 hover:text-destructive"
                            onClick={() => handleDeleteDeck(deck.id, deck.name)}
                            title={t({ it: 'Elimina mazzo', en: 'Delete deck' })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </MotionItem>
              );
            })}
          </MotionList>
        )}
      </main>

      <Sheet open={Boolean(detailsDeck)} onOpenChange={(open) => { if (!open) setDetailsDeck(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto border-border bg-card p-0 sm:max-w-xl">
          {detailsDeck ? (() => {
            const performance = deckPerformance.get(detailsDeck.id);
            return (
              <>
                <div className="relative overflow-hidden border-b border-border">
                  <DeckImage src={detailsDeck.commander_image} alt={detailsDeck.commander} className="h-52 w-full object-cover object-top opacity-45" />
                  <div className="absolute inset-0 bg-gradient-to-t from-card via-card/65 to-transparent" />
                  <SheetHeader className="absolute inset-x-0 bottom-0 p-5 text-left">
                    <SheetTitle className="pr-8 text-2xl">{detailsDeck.name}</SheetTitle>
                    <SheetDescription className="text-emerald-200">{detailsDeck.commander}</SheetDescription>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <BracketBadge bracket={detailsDeck.bracket} />
                      <ManaColorPills colors={getDeckDisplayColors(detailsDeck)} size="xs" gap="tight" />
                    </div>
                  </SheetHeader>
                </div>
                <div className="space-y-6 p-5">
                  {!metricsLoading && !metricsError ? <DeckPerformancePanel performance={performance} /> : null}
                </div>
              </>
            );
          })() : null}
        </SheetContent>
      </Sheet>

      {/* Add Deck Modal */}
      {showAddModal && (
        <ModalOverlay>
          <ModalCard size="lg">
            <CardHeader className="shrink-0 border-b border-border/70">
              <CardTitle className="text-foreground">{t({ it: 'Aggiungi mazzo', en: 'Add Deck' })}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {addMode === 'choose' && t({ it: 'Scegli come aggiungere il mazzo', en: 'Choose how to add your deck' })}
                {addMode === 'import-url' && t({ it: 'Importa da URL', en: 'Import from URL' })}
                {addMode === 'archidekt-user' && t({ it: 'Importa mazzi pubblici da Archidekt', en: 'Import public decks from Archidekt' })}
                {addMode === 'manual' && t({ it: 'Crea un mazzo con il tuo comandante', en: 'Create a deck with your commander' })}
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto py-6">
              {adminMode && (
                <div className="mb-4 space-y-2 rounded-lg border border-border/70 bg-background/35 p-3">
                  <label className="text-sm font-medium text-foreground">
                    {t({ it: 'Giocatore destinatario', en: 'Target player' })}
                  </label>
                  <Select
                    value={selectedTargetProfileId}
                    onValueChange={setSelectedTargetProfileId}
                    disabled={targetProfiles.length === 0 || savingDeck || savingUserDecks}
                  >
                    <SelectTrigger className="border-border bg-background/50 text-foreground">
                      <SelectValue placeholder={t({ it: 'Seleziona giocatore', en: 'Select player' })} />
                    </SelectTrigger>
                    <SelectContent>
                      {targetProfiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {getProfileDisplayName(profile)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {targetProfiles.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t({ it: 'Nessun altro giocatore registrato disponibile.', en: 'No other registered players available.' })}
                    </p>
                  )}
                </div>
              )}

              {addMode === 'choose' && (
                <div className="space-y-4">
                  <Button
                    variant="outline"
                    className="w-full h-24 flex flex-col items-center justify-center gap-2 border-border hover:border-emerald-500 hover:bg-emerald-500/10"
                    onClick={() => setAddMode('import-url')}
                  >
                    <ExternalLink className="w-6 h-6" />
                    <span>{t({ it: 'Importa da URL', en: 'Import from URL' })}</span>
                    <span className="text-xs text-muted-foreground">{t({ it: 'Archidekt o Moxfield (mazzi pubblici)', en: 'Archidekt or Moxfield (public decks)' })}</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-24 flex flex-col items-center justify-center gap-2 border-border hover:border-emerald-500 hover:bg-emerald-500/10"
                    onClick={() => setAddMode('manual')}
                  >
                    <Search className="w-6 h-6" />
                    <span>{t({ it: 'Aggiungi manualmente', en: 'Add manually' })}</span>
                    <span className="text-xs text-muted-foreground">{t({ it: 'Cerca un comandante', en: 'Search for a commander' })}</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-24 flex flex-col items-center justify-center gap-2 border-border hover:border-emerald-500 hover:bg-emerald-500/10"
                    onClick={() => {
                      setArchidektUsername(currentProfile?.archidekt_username || '');
                      setAddMode('archidekt-user');
                    }}
                  >
                    <UserIcon className="w-6 h-6" />
                    <span>{t({ it: 'Importa per username Archidekt', en: 'Import by Archidekt username' })}</span>
                    <span className="text-xs text-muted-foreground">{t({ it: 'Carica solo i mazzi pubblici', en: 'Load public decks only' })}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full text-muted-foreground"
                    onClick={closeAddModal}
                  >
                    {t({ it: 'Annulla', en: 'Cancel' })}
                  </Button>
                </div>
              )}

              {addMode === 'archidekt-user' && importedUserDecks.length === 0 && (
                <div className="space-y-4">
                  <Input
                    value={archidektUsername}
                    disabled={importingUserDecks}
                    onChange={(e) => setArchidektUsername(e.target.value)}
                    placeholder={t({ it: 'Username Archidekt', en: 'Archidekt username' })}
                    className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t({
                      it: 'Precompilato dal profilo. Puoi modificarlo per questa importazione; Archidekt restituisce solo i mazzi pubblici.',
                      en: 'Pre-filled from your profile. You can change it for this import; Archidekt returns public decks only.',
                    })}
                  </p>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 border-border text-foreground"
                      onClick={() => setAddMode('choose')}
                    >
                      {t({ it: 'Indietro', en: 'Back' })}
                    </Button>
                    <Button
                      className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                      onClick={handleArchidektUserImport}
                      disabled={importingUserDecks || !archidektUsername.trim()}
                    >
                      {importingUserDecks ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t({ it: 'Caricamento...', en: 'Loading...' })}
                        </>
                      ) : (
                        t({ it: 'Carica mazzi', en: 'Load Decks' })
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {addMode === 'archidekt-user' && importedUserDecks.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {selectedUserDeckUrls.length}/{importedUserDecks.length} {t({ it: importedUserDecks.length === 1 ? 'mazzo selezionato' : 'mazzi selezionati', en: importedUserDecks.length === 1 ? 'deck selected' : 'decks selected' })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t({
                          it: 'Scegli quale comandante mostrare sui mazzi partner/DFC. Le art si cambiano dal profilo dopo l\'import.',
                          en: 'Choose which commander to display on partner/DFC decks. Change art from your profile after import.',
                        })}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setSelectedUserDeckUrls(importedUserDecks.map((deck) => deck.sourceUrl))} disabled={savingDeck || savingUserDecks}
                      >
                        {t({ it: 'Tutti', en: 'All' })}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setSelectedUserDeckUrls([])} disabled={savingDeck || savingUserDecks}
                      >
                        {t({ it: 'Nessuno', en: 'None' })}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                    {importedUserDecks.map((deck) => {
                      const selectedCommander = selectedUserDeckCommanders[deck.sourceUrl] || getDefaultImportedCommanderOption(deck);
                      const alreadySaved = decks.some((savedDeck) =>
                        savedDeck.user_id === getTargetProfileId() &&
                        savedDeck.source_url === deck.sourceUrl
                      );
                      const selectedForImport = selectedUserDeckUrls.includes(deck.sourceUrl);

                      return (
                        <div key={deck.sourceUrl} className={`rounded-lg border p-3 transition-colors ${
                          selectedForImport ? 'border-border bg-background/40' : 'border-border/60 bg-background/20 opacity-70'
                        }`}>
                          <div className="flex gap-3">
                            <button
                              type="button"
                              className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                                selectedForImport
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
                                  : 'border-border bg-background'
                              }`}
                              onClick={() => setSelectedUserDeckUrls((current) =>
                                selectedForImport
                                  ? current.filter((url) => url !== deck.sourceUrl)
                                  : [...current, deck.sourceUrl]
                              )}
                              aria-label={selectedForImport
                                ? t({ it: 'Escludi mazzo', en: 'Exclude deck' })
                                : t({ it: 'Includi mazzo', en: 'Include deck' })} disabled={savingDeck || savingUserDecks}
                            >
                              {selectedForImport && <Check className="h-3.5 w-3.5" />}
                            </button>
                            <DeckImage
                              src={selectedCommander.imageUrl}
                              alt={selectedCommander.name}
                              className="w-20 h-14 object-cover object-top rounded"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                {getSourceBadge(deck.sourceType)}
                                <BracketBadge
                                  bracket={deck.bracket}
                                  className="rounded-full border border-emerald-500/30 px-2"
                                />
                                {alreadySaved && (
                                  <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                                    {t({ it: 'Gia presente', en: 'Already saved' })}
                                  </span>
                                )}
                              </div>
                              <p className="font-semibold text-foreground truncate">{deck.name}</p>
                              <p className="text-sm text-emerald-400 truncate">{selectedCommander.name}</p>
                            </div>
                          </div>
                          {(deck.commanderOptions?.length || 0) > 1 && (
                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {deck.commanderOptions?.map((commander) => {
                                const selected = isImportedCommanderOptionSelected(selectedCommander, commander);
                                return (
                                  <button
                                    key={`${deck.sourceUrl}-${commander.name}`}
                                    type="button"
                                    onClick={() => setSelectedUserDeckCommanders((current) => ({
                                      ...current,
                                      [deck.sourceUrl]: commander,
                                    }))}
                                    className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                                      selected
                                        ? 'border-emerald-500 bg-emerald-500/10'
                                        : 'border-border hover:border-emerald-500/50'
                                    }`} disabled={savingDeck || savingUserDecks}
                                  >
                                    <DeckImage
                                      src={commander.imageUrl}
                                      alt={commander.name}
                                      className="h-12 w-16 rounded object-cover object-top"
                                    />
                                    <span className="min-w-0 flex-1 text-xs font-medium text-foreground">{commander.name}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 border-border text-foreground"
                      onClick={clearArchidektPreview}
                  >
                      {t({ it: 'Indietro', en: 'Back' })}
                    </Button>
                    <Button
                      className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                      onClick={saveArchidektUserDecks}
                      disabled={savingUserDecks || selectedUserDeckUrls.length === 0 || !getTargetProfileId()}
                    >
                      {savingUserDecks ? t({ it: 'Salvataggio...', en: 'Saving...' }) : t({ it: 'Salva mazzi', en: 'Save Decks' })}
                    </Button>
                  </div>
                </div>
              )}

              {addMode === 'import-url' && !importedDeck && (
                <div className="space-y-4">
                  <Input
                    value={importDeckUrl}
                    disabled={importingDeck}
                    onChange={(e) => setImportDeckUrl(e.target.value)}
                    placeholder="https://archidekt.com/decks/123456 o https://www.moxfield.com/decks/..."
                    className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t({
                      it: 'Supporta link pubblici Archidekt e Moxfield. I mazzi privati non possono essere importati.',
                      en: 'Supports public Archidekt and Moxfield links. Private decks cannot be imported.',
                    })}
                  </p>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 border-border text-foreground"
                      onClick={() => setAddMode('choose')}
                    >
                      {t({ it: 'Indietro', en: 'Back' })}
                    </Button>
                    <Button
                      className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                      onClick={handleUrlImport}
                      disabled={importingDeck || !importDeckUrl.trim()}
                    >
                      {importingDeck ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t({ it: 'Analisi...', en: 'Importing...' })}
                        </>
                      ) : (
                        t({ it: 'Analizza mazzo', en: 'Import Deck' })
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {addMode === 'import-url' && importedDeck && (
                <div className="space-y-4">
                  <div className="flex gap-4 p-4 rounded-lg bg-background/50 border-border">
                    <DeckImage
                      src={selectedImportedCommander?.imageUrl || importedDeck.commanderImageUrl}
                      alt={selectedImportedCommander?.name || importedDeck.commander}
                      className="w-28 h-20 object-cover object-top rounded"
                    />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        {getSourceBadge(importedDeck.sourceType)}
                        <BracketBadge
                          bracket={importedDeck.bracket}
                          className="rounded-full border border-emerald-500/30 px-2"
                        />
                      </div>
                      <h4 className="font-semibold text-foreground line-clamp-1">
                        {importedDeck.name}
                      </h4>
                      <p className="text-sm text-emerald-400">{selectedImportedCommander?.name || importedDeck.commander}</p>
                      <EdhrecDeckInsights
                        commander={selectedImportedCommander?.name || importedDeck.commander}
                        localBracket={importedDeck.bracket}
                        showBracketComparison
                        layout="stacked"
                        linkVariant="chip"
                        linkClassName="w-full sm:w-auto"
                        className="mt-2"
                      />
                    </div>
                  </div>
                  {(importedDeck.commanderOptions?.length || 0) > 1 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">
                        {t({ it: 'Scegli comandante da mostrare', en: 'Choose commander to display' })}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {importedDeck.commanderOptions?.map((commander) => {
                          const selected = isImportedCommanderOptionSelected(selectedImportedCommander, commander);
                          return (
                            <button
                              key={commander.name}
                              type="button"
                              onClick={() => selectImportedCommander(commander)}
                              className={`flex items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                                selected
                                  ? 'border-emerald-500 bg-emerald-500/10'
                                  : 'border-border hover:border-emerald-500/50'
                              }`} disabled={savingDeck || savingUserDecks}
                            >
                              <DeckImage
                                src={commander.imageUrl}
                                alt={commander.name}
                                className="h-14 w-20 rounded object-cover object-top"
                              />
                              <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{commander.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {selectedImportedCommander && renderCommanderArtPicker(
                    importedCommanderArts,
                    selectedImportedCommander.imageUrl,
                    selectImportedArt,
                    loadingImportedCommanderArts
                  )}
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 border-border text-foreground"
                      onClick={resetUrlImport}
                    >
                      {t({ it: 'Annulla', en: 'Cancel' })}
                    </Button>
                    <Button
                      className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                      onClick={saveArchidektDeck}
                      disabled={savingDeck || !getTargetProfileId()}
                    >
                      {savingDeck ? t({ it: 'Salvataggio...', en: 'Saving...' }) : t({ it: 'Salva mazzo', en: 'Save Deck' })}
                    </Button>
                  </div>
                </div>
              )}

              {addMode === 'manual' && !selectedCommander && (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t({ it: 'Cerca comandante per nome...', en: 'Search commander by name...' })}
                      className="pl-9 bg-background/50 border-border text-foreground placeholder:text-muted-foreground" disabled={savingDeck || savingUserDecks}
                    />
                    {searching && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {searchResults.length > 0 && (
                    <div className="max-h-64 overflow-y-auto space-y-2 border border-border rounded-lg p-2">
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          className="w-full flex items-center gap-3 p-2 rounded hover:bg-accent transition-colors text-left"
                          onClick={() => handleSelectCommander(result)}
                        >
                          {result.imageUrl ? (
                            <DeckImage
                              src={result.imageUrl}
                              alt={result.name}
                              className="w-12 h-16 rounded object-cover object-top"
                            />
                          ) : (
                            <div className="w-12 h-16 bg-secondary rounded flex items-center justify-center">
                              <Swords className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-foreground">{result.name}</p>
                            <p className="text-xs text-muted-foreground">{result.typeLine}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {t({ it: 'Nessun comandante trovato per', en: 'No commanders found for' })} &quot;{searchQuery}&quot;
                    </p>
                  )}

                  <Button
                    variant="outline"
                    className="w-full border-border text-foreground"
                    onClick={() => {
                      setAddMode('choose');
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                  >
                    {t({ it: 'Indietro', en: 'Back' })}
                  </Button>
                </div>
              )}

              {addMode === 'manual' && selectedCommander && (
                <div className="space-y-4">
                  <div className="flex gap-4 p-4 rounded-lg bg-background/50 border-border">
                    {selectedCommander.imageUrl ? (
                      <DeckImage
                        src={selectedCommander.imageUrl}
                        alt={selectedCommander.name}
                        className="w-20 h-28 object-cover object-top rounded"
                      />
                    ) : (
                      <div className="w-20 h-28 bg-secondary rounded flex items-center justify-center">
                        <Swords className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground mb-1">{t({ it: 'Comandante', en: 'Commander' })}</p>
                      <p className="font-semibold text-foreground">{selectedCommander.name}</p>
                      <p className="text-xs text-muted-foreground">{selectedCommander.typeLine}</p>
                    </div>
                  </div>

                  {renderCommanderArtPicker(
                    manualCommanderArts,
                    selectedCommander.imageUrl,
                    (art) => setSelectedCommander((current) => current ? { ...current, imageUrl: art.imageUrl } : current),
                    loadingManualCommanderArts
                  )}

                  {manualPartnerMode && manualPartnerCopy && (
                    <div className="space-y-3 rounded-lg border border-border bg-background/35 p-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">{manualPartnerCopy.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t({ it: 'Aggiungi un secondo comandante se vuoi salvare la coppia.', en: 'Add a second commander if you want to save the pair.' })}
                        </p>
                      </div>

                      {selectedPartnerCommander && (
                        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2">
                          {selectedPartnerCommander.imageUrl ? (
                            <DeckImage
                              src={selectedPartnerCommander.imageUrl}
                              alt={selectedPartnerCommander.name}
                              className="h-16 w-12 rounded object-cover object-top"
                            />
                          ) : (
                            <div className="h-16 w-12 rounded bg-secondary flex items-center justify-center">
                              <Swords className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-foreground">{selectedPartnerCommander.name}</p>
                            <p className="text-xs text-muted-foreground">{selectedPartnerCommander.typeLine}</p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            onClick={() => {
                              const combinedName = `${selectedCommander.name} // ${selectedPartnerCommander.name}`;
                              setSelectedPartnerCommander(null);
                              setPartnerSearchQuery('');
                              setPartnerSearchResults([]);
                              if (customDeckName === combinedName) setCustomDeckName(selectedCommander.name);
                            }} disabled={savingDeck || savingUserDecks}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )}

                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          value={partnerSearchQuery}
                          onChange={(e) => setPartnerSearchQuery(e.target.value)}
                          placeholder={manualPartnerCopy.placeholder}
                          className="pl-9 bg-background/50 border-border text-foreground placeholder:text-muted-foreground" disabled={savingDeck || savingUserDecks}
                        />
                        {searchingPartner && (
                          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                        )}
                      </div>

                      {partnerSearchResults.length > 0 && (
                        <div className="max-h-52 overflow-y-auto space-y-2 rounded-lg border border-border p-2">
                          {partnerSearchResults.map((result) => (
                            <button
                              key={result.id}
                              type="button"
                              className="w-full flex items-center gap-3 rounded p-2 text-left transition-colors hover:bg-accent"
                              onClick={() => {
                                setSelectedPartnerCommander(result);
                                setPartnerSearchQuery(result.name);
                                setPartnerSearchResults([]);
                                const combinedName = `${selectedCommander.name} // ${result.name}`;
                                if (!customDeckName || customDeckName === selectedCommander.name) setCustomDeckName(combinedName);
                              }} disabled={savingDeck || savingUserDecks}
                            >
                              {result.imageUrl ? (
                                <DeckImage
                                  src={result.imageUrl}
                                  alt={result.name}
                                  className="h-16 w-12 rounded object-cover object-top"
                                />
                              ) : (
                                <div className="h-16 w-12 rounded bg-secondary flex items-center justify-center">
                                  <Swords className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-medium text-foreground">{result.name}</p>
                                <p className="text-xs text-muted-foreground">{result.typeLine}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {partnerSearchQuery.length >= 2 && partnerSearchResults.length === 0 && !searchingPartner && !selectedPartnerCommander && (
                        <p className="text-sm text-muted-foreground text-center py-2">
                          {manualPartnerCopy.empty}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t({ it: 'Nome mazzo', en: 'Deck Name' })}</label>
                    <Input
                      value={customDeckName}
                      onChange={(e) => setCustomDeckName(e.target.value)}
                      placeholder={`${selectedCommander.name}`}
                      className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground" disabled={savingDeck || savingUserDecks}
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 border-border text-foreground"
                      onClick={() => {
                        setSelectedCommander(null);
                        setPartnerSearchQuery('');
                        setPartnerSearchResults([]);
                        setSelectedPartnerCommander(null);
                        setCustomDeckName('');
                      }}
                    >
                      {t({ it: 'Indietro', en: 'Back' })}
                    </Button>
                    <Button
                      className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                      onClick={saveManualDeck}
                      disabled={savingDeck || !getTargetProfileId()}
                    >
                      {savingDeck ? t({ it: 'Salvataggio...', en: 'Saving...' }) : t({ it: 'Aggiungi mazzo', en: 'Add Deck' })}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </ModalCard>
        </ModalOverlay>
      )}

      {editingArtDeck && (
        <ModalOverlay>
          <ModalCard size="xl">
            <CardHeader className="shrink-0 border-b border-border/70">
              <CardTitle className="text-foreground">{t({ it: 'Modifica comandante', en: 'Edit commander' })}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {editingArtDeck.name}
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto py-6">
              {deckCommanderOptions.length > 1 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    {t({ it: 'Comandante da mostrare', en: 'Commander to display' })}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {deckCommanderOptions.map((commander) => {
                      const selected = selectedDeckCommander?.name === commander.name;
                      return (
                        <button
                          key={commander.name}
                          type="button"
                          className={`flex min-w-0 items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                            selected ? 'border-emerald-500 bg-emerald-500/10' : 'border-border bg-background/30 hover:border-emerald-500/50'
                          }`}
                          disabled={savingDeckArt}
                          onClick={() => selectDeckCommander(commander)}
                        >
                          <DeckImage
                            src={commander.imageUrl}
                            alt={commander.name}
                            className="h-14 w-14 shrink-0 rounded-md object-cover object-top"
                            fallbackClassName="h-14 w-14 shrink-0 rounded-md"
                          />
                          <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{commander.name}</span>
                          {selected && <Check className="h-4 w-4 shrink-0 text-emerald-300" />}
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-border text-foreground"
                    disabled={
                      savingDeckArt ||
                      !selectedDeckCommander ||
                      (
                        selectedDeckCommander.name === editingArtDeck.commander &&
                        (selectedDeckCommander.imageUrl || null) === (editingArtDeck.commander_image || null)
                      )
                    }
                    onClick={() => selectedDeckCommander && void saveDeckCommanderPresentation(
                      selectedDeckCommander.name,
                      selectedDeckCommander.imageUrl || editingArtDeck.commander_image
                    )}
                  >
                    {t({ it: 'Salva comandante selezionato', en: 'Save selected commander' })}
                  </Button>
                </div>
              )}
              {renderCommanderArtPicker(
                deckArtOptions,
                selectedDeckCommander?.name === editingArtDeck.commander
                  ? editingArtDeck.commander_image
                  : selectedDeckCommander?.imageUrl,
                (art) => void saveDeckCommanderPresentation(
                  selectedDeckCommander?.name || editingArtDeck.commander,
                  art.imageUrl
                ),
                loadingDeckArtOptions || savingDeckArt
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="border-border text-foreground"
                  onClick={closeCommanderEditor}
                  disabled={savingDeckArt}
                >
                  {t({ it: 'Chiudi', en: 'Close' })}
                </Button>
              </div>
            </CardContent>
          </ModalCard>
        </ModalOverlay>
      )}

      {linkingDeck && (
        <ModalOverlay>
          <ModalCard size="md">
            <CardHeader className="shrink-0 border-b border-border/70">
              <CardTitle className="text-foreground">{t({ it: 'Collega lista esterna', en: 'Link external list' })}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t({
                  it: 'Il nome e il comandante attuali restano invariati. Il link abilita aggiornamenti, bracket e metadati dalla lista.',
                  en: 'Your current name and commander stay unchanged. The link enables source refreshes, bracket and metadata.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 py-6">
              <Input
                value={linkDeckUrl}
                onChange={(event) => setLinkDeckUrl(event.target.value)}
                placeholder="https://archidekt.com/decks/... oppure https://moxfield.com/decks/..."
                autoFocus
                className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-border text-foreground"
                  disabled={savingDeckLink}
                  onClick={() => {
                    setLinkingDeck(null);
                    setLinkDeckUrl('');
                  }}
                >
                  {t({ it: 'Annulla', en: 'Cancel' })}
                </Button>
                <Button
                  type="button"
                  disabled={savingDeckLink || !linkDeckUrl.trim()}
                  className="bg-gradient-to-r from-emerald-600 to-teal-700"
                  onClick={() => void handleLinkDeckToExternalSource()}
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  {savingDeckLink ? t({ it: 'Collegamento...', en: 'Linking...' }) : t({ it: 'Collega lista', en: 'Link list' })}
                </Button>
              </div>
            </CardContent>
          </ModalCard>
        </ModalOverlay>
      )}

      <ProfileDeckOverwriteDialog controls={{ overwriteConfirm, closeOverwriteConfirm }} />
    </div>
  );
}
