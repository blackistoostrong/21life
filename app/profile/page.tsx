'use client';

import { resolveCommanderColorOptions } from '@/lib/profile-commander';
import type { CommanderArtOption } from '@/lib/profile-commander';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MotionPanel } from '@/components/ui/motion';
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
import { DeckImage } from '@/components/deck-image';
import { useLanguage } from '@/components/language-provider';
import { usePlatformAdmin } from '@/hooks/use-platform-admin';

import { RESERVED_USERNAMES } from '@/lib/reserved-usernames';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { getDeckDisplayColors } from '@/lib/deck-metadata';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';

import { deckDataToColorFields, isImportedDeckSource } from '@/lib/deck-importers';
import {
  resolveDeckCommanderCmc,
} from '@/lib/deck-commander-cmc';
import { BracketBadge } from '@/components/deck/bracket-badge';
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
import { ProfileDeckImportForms } from '@/components/profile/profile-deck-import-forms';
import { CommanderArtPicker } from '@/components/profile/commander-art-picker';
import { ProfileDeckGrid } from '@/components/profile/profile-deck-grid';
import { ProfileManualDeckForm } from '@/components/profile/profile-manual-deck-form';
import { useProfileManualDeck } from '@/hooks/use-profile-manual-deck';
import { useProfileDirectory } from '@/hooks/use-profile-directory';
import { ProfileNicknameDirectory } from '@/components/profile/profile-nickname-directory';
import type { ProfileDirectoryEntry as Profile } from '@/lib/types/profile-directory';
import { useProfileDeckRefresh } from '@/hooks/use-profile-deck-refresh';
import { useProfileDeckCollection } from '@/hooks/use-profile-deck-collection';
import { ProfileDeckFilters } from '@/components/profile/profile-deck-filters';
import { useProfileCatalog } from '@/hooks/use-profile-catalog';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';
import { useProfileMetadataEnrichment } from '@/hooks/use-profile-metadata-enrichment';
import { useProfileMetrics } from '@/hooks/use-profile-metrics';
import { getProfileDisplayName } from '@/lib/profile-display';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { ManaColorPills } from '@/components/ui/mana-color-pills';
import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import { ProfileDeckOverwriteDialog } from '@/components/profile/profile-deck-overwrite-dialog';
import { ArrowLeft, Plus, ExternalLink, Swords, Trophy, Crown, Search, User as UserIcon, RefreshCw, Check, Link2, Star, Archive } from 'lucide-react';
import Link from 'next/link';

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
  const urlImport = useProfileUrlImport(user && !adminLoading ? user.id + ':' + adminMode : null,
    showAddModal && addMode === 'import-url', fetchCommanderArts);
  const {
    importedDeck, selectedImportedCommander, resetUrlImport,
  } = urlImport;
  const archidektImport = useProfileArchidektImport(user && !adminLoading ? user.id + ':' + adminMode : null,
    showAddModal && addMode === 'archidekt-user', currentProfile?.archidekt_username || '');
  const {
    setArchidektUsername, importedUserDecks, selectedUserDeckCommanders,
    selectedUserDeckUrls, resetArchidektImport,
  } = archidektImport;
  const archidektSettings = useProfileArchidektSettings(user && !adminLoading ? user.id + ':' + adminMode : null,
    user?.id ?? null, currentProfile, setProfiles);
  const manual = useProfileManualDeck(
    user && !adminLoading ? user.id + ':' + adminMode : null,
    showAddModal && addMode === 'manual', fetchCommanderArts);
  const { selectedCommander, selectedPartnerCommander, customDeckName, freezeManualSelection } = manual;

  const {
    editingArtDeck, deckCommanderOptions, selectedDeckCommander, deckArtOptions,
    loadingDeckArtOptions, savingDeckArt, openDeckArtEditor, selectDeckCommander,
    saveDeckCommanderPresentation, closeCommanderEditor,
  } = useProfileCommanderEditor(user && !adminLoading ? user.id + ':' + adminMode : null,
    fetchCommanderArts, setDecks);
  const [linkingDeck, setLinkingDeck] = useState<Deck | null>(null);
  const [linkDeckUrl, setLinkDeckUrl] = useState('');
  const [savingDeckLink, setSavingDeckLink] = useState(false);

  const { deckWinRates, deckPerformance, metricsLoading, metricsError, refreshMetrics } = useProfileMetrics(adminLoading ? undefined : user?.id, adminMode, decks);
  const collection = useProfileDeckCollection(decks, adminMode, user?.id, deckPerformance);
  const { visibleDecks, archivedDecks, filteredDecks, personalSnapshot, deckPlayerFilter } = collection;
  const { refreshCommandsBusy, refreshingDecks, refreshingDeckIds, deckNeedsRefreshWork, handleRefreshDecks,
    handleRefreshImportedDeck } = useProfileDeckRefresh(user && !adminLoading ? user.id + ':' + adminMode : null, visibleDecks, setDecks);
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

  const setDeckArchived = useCallback(async (deck: Deck, archived: boolean) => {
    if (!user || deck.user_id !== user.id || deck.group_id !== null) return;
    const { error } = await supabase.from('decks').update({ is_archived: archived })
      .eq('id', deck.id).eq('user_id', user.id).is('group_id', null);
    if (error) throw error;
    setDecks((current) => current.map((entry) => entry.id === deck.id ? { ...entry, is_archived: archived } : entry));
    toast({ title: t(archived ? { it: 'Mazzo archiviato', en: 'Deck archived' } : { it: 'Mazzo ripristinato', en: 'Deck restored' }) });
  }, [setDecks, t, toast, user]);

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

  const closeAddModal = () => {
    setShowAddModal(false);
    setAddMode('choose');
    resetUrlImport();
    resetArchidektImport();
    manual.resetManualDeck();
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

  const renderCommanderArtPicker = (
    arts: CommanderArtOption[], selectedImageUrl: string | null | undefined,
    onSelect: (art: CommanderArtOption) => void, loadingArts: boolean
  ) => <CommanderArtPicker arts={arts} selectedImageUrl={selectedImageUrl} onSelect={onSelect}
    loadingArts={loadingArts} busy={savingDeck || savingUserDecks} />;

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
              disabled={refreshCommandsBusy || !visibleDecks.some(deckNeedsRefreshWork)}
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

        <ProfileDeckFilters controls={collection} adminMode={adminMode} targetProfiles={targetProfiles} />

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
          <ProfileDeckGrid filteredDecks={filteredDecks} deckPerformance={deckPerformance} deckWinRates={deckWinRates}
            adminMode={adminMode} userId={user.id} metricsLoading={metricsLoading} metricsError={metricsError}
            refreshingDeckIds={refreshingDeckIds} refreshCommandsBusy={refreshCommandsBusy} onDetails={setDetailsDeck} onFavorite={toggleDeckFavorite}
            onArchive={(deck) => void setDeckArchived(deck, true).catch((error) => toast({ title: t({ it: 'Errore', en: 'Error' }), description: getSupabaseErrorMessage(error, t({ it: 'Archiviazione non riuscita', en: 'Failed to archive deck' })), variant: 'destructive' }))}
            onLink={(deck) => { setLinkingDeck(deck); setLinkDeckUrl(deck.source_url || ''); }}
            onRefresh={handleRefreshImportedDeck} onEditCommander={openDeckArtEditor} onDelete={handleDeleteDeck} />
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

              <ProfileDeckImportForms urlControls={urlImport} archidektControls={archidektImport}
                addMode={addMode} savingDeck={savingDeck} savingUserDecks={savingUserDecks}
                decks={decks} targetProfileId={getTargetProfileId()} onChooseMode={() => setAddMode('choose')}
                onSaveUrl={saveArchidektDeck} onSaveBulk={saveArchidektUserDecks}
                renderArtPicker={renderCommanderArtPicker} />

              <ProfileManualDeckForm controls={manual} addMode={addMode} savingDeck={savingDeck}
                savingUserDecks={savingUserDecks} hasTarget={Boolean(getTargetProfileId())} onSave={saveManualDeck}
                onChooseMode={() => setAddMode('choose')} renderArtPicker={renderCommanderArtPicker} />

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
