'use client';
import { useArenaSessionExport } from '@/hooks/use-arena-session-export';
import { useArenaSharing } from '@/hooks/use-arena-sharing';
import { useWebArenaRecap } from '@/hooks/use-web-arena-recap';
import { ArenaRecapDialog } from '@/components/arena/arena-recap-dialog';
import { ArenaHistoryPanel } from '@/components/arena/arena-history-panel';
import { ArenaPlayerReport } from '@/components/arena/arena-player-report';
import { ArenaMemberRoster } from '@/components/arena/arena-member-roster';
import { useArenaReportScope, useArenaReports } from '@/hooks/use-arena-reports';
import { ArenaAwardsPanel } from '@/components/arena/arena-awards-panel';
import { ArenaDeckRankingsPanel } from '@/components/arena/arena-deck-rankings-panel';
import { ArenaMetaPanel } from '@/components/arena/arena-meta-panel';
import { useArenaActiveGame } from '@/hooks/use-arena-active-game';
import { useArenaMatchDetails } from '@/hooks/use-arena-match-details';
import { ArenaMatchDetailsDialog } from '@/components/arena/arena-match-details-dialog';
import { ArenaMatchEditDialog } from '@/components/arena/arena-match-edit-dialog';
import { useArenaMatchEditor } from '@/hooks/use-arena-match-editor';
import type { Match } from '@/lib/types/arena-match';
import { ArenaMatchCreateDialog } from '@/components/arena/arena-match-create-dialog';
import { useArenaMatchCreation } from '@/hooks/use-arena-match-creation';
import { useArenaMatchDeletion } from '@/hooks/use-arena-match-deletion';
import { useArenaGuestCommands } from '@/hooks/use-arena-guest-commands';
import { ArenaGuestDialog } from '@/components/arena/arena-guest-dialog';
import { useArenaMembership } from '@/hooks/use-arena-membership';
import { ArenaMembershipDialogs } from '@/components/arena/arena-membership-dialogs';
import { useArenaDeckEnrichment } from '@/hooks/use-arena-deck-enrichment';
import { useArenaCatalog } from '@/hooks/use-arena-catalog';
import type { Deck } from '@/lib/types/arena-catalog';
import { ArenaCatalogError } from '@/components/arena/arena-catalog-error';
import { ArenaSettingsEditor } from '@/components/arena/arena-settings-editor';
import {GuestDirectory} from '@/components/arena/guest-directory';
import {useArenaMatchHistory} from '@/hooks/use-arena-match-history';

import {useArenaSeasonContext} from '@/hooks/use-arena-season-context';

import { useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

import { ArenaInviteQrDialog } from '@/components/arena/arena-invite-qr-dialog';

import { useLanguage } from '@/components/language-provider';
import { usePlatformAdmin } from '@/hooks/use-platform-admin';

import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';

import { PanelWithActions } from '@/components/ui/panel-with-actions';

import { RichTextEditor } from '@/components/ui/rich-text-editor';

import { canLeaveArena, isArenaMember } from '@/lib/arena-membership';
import { isDemoUser } from '@/lib/demo';
import { getParticipantDeckId, type ArenaGuestDeck } from '@/lib/arena-participants';

import {
  formatArenaSeasonDate,
  formatArenaSeasonLabel,
} from '@/lib/arena-seasons';

import { toMatchDateValue } from '@/lib/match-datetime';
import { parseParticipantKey, type ParticipantKey } from '@/lib/participant-keys';

import { Swords, ArrowLeft, Users, Trash2, Copy, Calendar, Download, Target, Pencil, Share2, Palette, DoorOpen, Award, QrCode } from 'lucide-react';

const MATCHES_SELECT = `
  *,
  winner:winner_id (id, username, display_name),
  winner_guest:arena_guests!matches_winner_guest_id_fkey (id, display_name),
  match_participants (
    id,
    user_id,
    guest_id,
    deck_id,
    guest_deck_id,
    is_winner,
    tracked_event_count,
    life_lost,
    life_gained,
    life_damage_dealt,
    unattributed_life_lost,
    commander_damage_taken,
    commander_damage_dealt,
    infect_received,
    infect_dealt,
    eliminations,
    eliminations_caused,
    revives,
    corrections,
    placement,
    eliminated_at,
    was_starting_player,
    group_damage_dealt,
    group_damage_events,
    participant_name_snapshot,
    deck_name_snapshot,
    commander_snapshot,
    commander_image_snapshot,
    deck_bracket_snapshot,
    color_identity_snapshot,
    final_life,
    final_infect,
    profiles (id, username, display_name),
    arena_guests (id, display_name),
    decks (name, commander, commander_image, bracket, color_identity, source_type),
    arena_guest_decks (name, commander, commander_image, bracket, color_identity)
  )
`;

function extractMatchDeckIds(matches: Match[]) {
  return Array.from(new Set(
    matches.flatMap((match) => match.match_participants.map((participant) => getParticipantDeckId(participant)).filter(Boolean))
  )) as string[];
}

export default function TablePage() {
  const params = useParams();
  const groupId = typeof params.id==='string'?params.id:'';
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { copy: t, language } = useLanguage();
  const { adminMode } = usePlatformAdmin();
  const { group, setGroup, decks, setDecks, members, setMembers, guests, loading, decksLoading,
    deckColorOverrides, updateDeckColors, catalogError, guestsError, decksError,
    fetchData, reloadGuests, loadArenaDecks, ensureArenaMemberDecksLoaded } = useArenaCatalog(user?.id ?? null, groupId, adminMode);
  const recap = useWebArenaRecap(user?.id ?? '', groupId, group?.name ?? '');
  const season=useArenaSeasonContext(user?.id,groupId);
  const seasonContext=season.data;
  const [activeTab, setActiveTab] = useState('matches');
  const activeLiveGameId = useArenaActiveGame(user?.id ?? null, groupId, adminMode);
  const { dateFilter, setDateFilter, bracketFilter, setBracketFilter, reportSince } = useArenaReportScope(season);
  const history=useArenaMatchHistory(season.ready?user?.id:undefined,groupId,reportSince);
  const arenaReports = useArenaReports(user?.id ?? null, groupId, reportSince, seasonContext, season.ready, bracketFilter);
  const {
    awardsView,
    setAwardsView,
    deckStatsSort,
    setDeckStatsSort,
    showProvisionalDecks,
    setShowProvisionalDecks,
    reportAnalytics,
    analyticsPayload,
    playerStats,
    deckStats,
    visibleDeckStats,
    provisionalDeckCount,
    playerRanksByIndex,
    commanderRanksByIndex,
    colorAnalytics,
    arenaAwards,
    playerAwards,
    arenaAwardGroups,
  } = arenaReports;
  const reportPanelStatus = {
    loading: season.loading || reportAnalytics.loading,
    error: season.error || reportAnalytics.error,
    onRetry: season.error ? season.reload : reportAnalytics.reload,
  };
  const matches=useMemo(()=>{
    const byId=new Map(decks.map(deck=>[deck.id,deck]));
    return (history.matches as unknown as Match[]).map(match=>({...match,match_participants:match.match_participants.map(participant=>{
      const deck=participant.deck_id?byId.get(participant.deck_id):null;
      return deck && participant.decks ? {...participant,decks:{...participant.decks,name:deck.name,commander:deck.commander,
        commander_image:deck.commander_image??participant.decks.commander_image,bracket:deck.bracket??participant.decks.bracket,
        color_identity:deck.color_identity??participant.decks.color_identity}}:participant;
    })}));
  },[history.matches,decks]);
  const [occasionalCreationBusy, setOccasionalCreationBusy] = useState<Record<string, boolean>>({});
  const anyOccasionalCreationBusy = Object.values(occasionalCreationBusy).some(Boolean);
  const [occasionalChoices, setOccasionalChoices] = useState<Deck[]>([]);
  const canManageGroup = Boolean(group && user && (group.created_by === user.id || adminMode));
  const matchAccessKey = JSON.stringify([adminMode, canManageGroup]);
  const matchCreation = useArenaMatchCreation({
    userId: user?.id ?? null, groupId, matchAccessKey, anyOccasionalCreationBusy, matches,
    getParticipantDeckOptions: key => getParticipantDeckOptions(key),
    refreshMissingImportedDeckImages: ids => refreshMissingImportedDeckImages(ids),
    refreshMatches: () => refreshMatches(), reloadGuests,
  });
  const {
    setShowMatchModal,
    setSelectedParticipantKeys,
    participantDecks,
    setParticipantDecks,
    winnerKey,
    setWinnerKey,
    setMatchPlayedAt,
    toggleParticipantSelection,
  } = matchCreation;
  const matchDetails = useArenaMatchDetails(user?.id ?? null, groupId, adminMode);
  const { setDetailsMatch } = matchDetails;
  const [showInviteQr, setShowInviteQr] = useState(false);

  // Edit arena modal state
  const arenaSettingsContext = user ? JSON.stringify([user.id, groupId]) : null;
  const [arenaSettingsOwner, setArenaSettingsOwner] = useState<string | null>(null);
  useEffect(() => { setArenaSettingsOwner(null); }, [arenaSettingsContext]);
  const matchEditor = useArenaMatchEditor({
    userId: user?.id ?? null, groupId, matchAccessKey, canManageGroup, anyOccasionalCreationBusy,
    members, guests, decks, occasionalChoices, setOccasionalChoices,
    getParticipantDeckOptions: key => getParticipantDeckOptions(key),
    refreshMissingImportedDeckImages: ids => refreshMissingImportedDeckImages(ids),
    refreshMatches: () => refreshMatches(),
  });
  const { editingMatch, editMatchPlayerDecks, openEditMatch } = matchEditor;
  const sessionExport = useArenaSessionExport(user?.id ?? null, groupId, history.scope, matches);
  const { expandedDayKeys, exportDayKey, exportIntro, setExportIntro, activeExportDayKey, dayExport, matchDayGroups, toggleDayGroup, openDayExportModal, closeDayExportModal, handleExportDayMatches } = sessionExport;




  useLayoutEffect(() => {
    setOccasionalChoices([]); setOccasionalCreationBusy({});
  }, [user?.id, groupId, matchAccessKey]);

  const currentUserIsMember = isArenaMember(members, user?.id);
  const canLeaveCurrentArena = canLeaveArena(members.length, currentUserIsMember);
  const membership = useArenaMembership(user, group, adminMode, canLeaveCurrentArena, setMembers);
  const { kickingMemberIds, membershipBusy, handleKickMember, openDeleteArenaModal, openLeaveArenaModal } = membership;

  const { refreshMissingImportedDeckImages, scheduleArenaDeckColors, syncingDeckColors } = useArenaDeckEnrichment(
    user?.id ?? null, groupId, adminMode, isDemoUser(user), decks, deckColorOverrides, matches, setDecks, updateDeckColors);

  const reloadHistory=history.reload;
  const reloadAnalytics=reportAnalytics.reload;
  const refreshMatches=useCallback(async()=>{
    const [page]=await Promise.all([reloadHistory(),reloadAnalytics()]);
    const ids=extractMatchDeckIds((page?.matches??[]) as unknown as Match[]);
    if(ids.length)scheduleArenaDeckColors(ids,5000,(page?.matches??[]) as unknown as Match[]);
  },[reloadHistory,reloadAnalytics,scheduleArenaDeckColors]);

  useEffect(() => {
    if (!authLoading && !user) router.push('/auth/login');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  const getFilteredMatches=useCallback(()=>matches,[matches]);



  useEffect(() => {
    if (!editingMatch) return;

    const timer = window.setTimeout(() => {
      Object.entries(editMatchPlayerDecks).forEach(([playerId, deckId]) => {
        if (!deckId) return;

        const row = document.querySelector(`[data-edit-deck-row="${playerId}"]`);
        const selectedDeck = row?.querySelector(`[data-edit-deck-option="${deckId}"]`);
        selectedDeck?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      });
    }, 150);

    return () => window.clearTimeout(timer);
  }, [editingMatch, editMatchPlayerDecks]);

  const bracketOptions = analyticsPayload.bracketOptions??[];

  const deckIdsInMatches = useMemo(() => Array.from(new Set(
    getFilteredMatches().flatMap((match) =>
      match.match_participants.map((participant) => getParticipantDeckId(participant)).filter(Boolean)
    )
  )) as string[], [getFilteredMatches]);

  useEffect(() => {
    if (activeTab !== 'meta' || loading) return;
    return scheduleArenaDeckColors(deckIdsInMatches, 2000);
  }, [activeTab, deckIdsInMatches, scheduleArenaDeckColors, loading]);

  const { copyInviteLink, getWinConditionLabel, handleShareMatch } = useArenaSharing({group});

  const getParticipantDeckOptions = (participantKey: ParticipantKey) => {
    const parsed = parseParticipantKey(participantKey);
    if (!parsed) return [] as Array<Deck | ArenaGuestDeck>;

    if (parsed.type === 'user') {
      return decks.filter((deck) => deck.user_id === parsed.id && deck.source_type !== 'occasional');
    }

    const guest = guests.find((entry) => entry.id === parsed.id);
    return guest?.arena_guest_decks || [];
  };

  const getFilteredParticipantDeckOptions = (
    participantKey: ParticipantKey,
    searchMap: Record<string, string>,
    searchKey = participantKey,
  ) => {
    const query = (searchMap[searchKey] || '').trim().toLowerCase();
    const deckList = getParticipantDeckOptions(participantKey);
    if (!query) return deckList;

    return deckList.filter((deck) => [
      deck.name,
      deck.commander,
      'source_type' in deck ? deck.source_type : 'guest',
      deck.bracket ? `bracket ${deck.bracket}` : null,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  };

  const getSelectedParticipantDeck = (participantKey: ParticipantKey) => {
    const deckId = participantDecks[participantKey];
    if (!deckId) return null;

    const parsed = parseParticipantKey(participantKey);
    if (!parsed) return null;

    if (parsed.type === 'user') {
      return [...decks, ...occasionalChoices].find((deck) => deck.id === deckId && deck.user_id === parsed.id) || null;
    }

    const guest = guests.find((entry) => entry.id === parsed.id);
    return guest?.arena_guest_decks?.find((deck) => deck.id === deckId) || null;
  };

  const guestCommands = useArenaGuestCommands({ userId: user?.id ?? null, adminMode, groupId, guests, canManageGroup, reloadGuests, refreshMatches,
    setSelectedParticipantKeys, setParticipantDecks, updateDeckColors, setWinnerKey, toggleParticipantSelection });
  const { deletingGuestIds, handleDeleteGuest, openGuestModal, openAddGuestDeckModal } = guestCommands;

  const { handleDeleteMatch, deletingMatch } = useArenaMatchDeletion(user?.id ?? null, groupId, adminMode, canManageGroup, matches, refreshMatches);







  if (authLoading || loading) {
    return <AppLoader label={t({ it: 'Caricamento playgroup...', en: 'Loading playgroup...' })} />;
  }

  if (catalogError) return <ArenaCatalogError resource="group" onRetry={fetchData} />;
  if (!group) return null;

  return (
    <div className="web-page min-h-screen">
      <header className="web-header phyrexian-divider safe-top sticky top-0 z-10 border-b">
        <div className="web-container max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <Button variant="ghost" size="icon" aria-label={t({ it: 'Torna alla home', en: 'Back to home' })} onClick={() => router.push('/dashboard')} className="h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="hidden sm:block">
                <ManaLogo size="sm" showText />
              </div>
              <div className="sm:hidden">
                <ManaLogo size="sm" />
              </div>
              <div className="hidden min-w-0 items-center gap-2 border-l border-border pl-2 sm:flex">
                <span className="rounded border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs uppercase tracking-[0.16em] text-emerald-200">
                  Playgroup
                </span>
                <span className="truncate font-semibold text-foreground">{group.name}</span>
                {group.description && <span className="hidden min-w-0 truncate text-sm text-muted-foreground md:block">— {group.description}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <AppProfileButton />
              <Button variant="outline" size="sm" onClick={() => void recap.controller.open()} disabled={!user?.id} className="h-11 border-border px-3 text-foreground sm:px-4" title={recap.labels.open} aria-label={recap.labels.open}>
                <Share2 className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">{recap.labels.open}</span>
              </Button>

            </div>
          </div>
        </div>
      </header>

      <main className="web-container max-w-7xl mx-auto px-3 sm:px-4 py-5 sm:py-8">
        {guestsError && <ArenaCatalogError resource="guests" onRetry={reloadGuests} />}
        {decksError && <ArenaCatalogError resource="decks" onRetry={() => loadArenaDecks(members.map(member => member.id))} />}
        <PanelWithActions
          variant="strong"
          className="relative mb-5 sm:mb-8"
          actions={(
            <>
              <Button
                onClick={() => router.push(`/table/${groupId}/play`)}
                className="flex-1 bg-gradient-to-r from-emerald-600 via-teal-600 to-teal-600 font-bold shadow-lg shadow-emerald-950/30 hover:from-emerald-500 hover:to-teal-500"
              >
                <Swords className="mr-2 h-4 w-4" />
                {activeLiveGameId
                  ? t({ it: 'Riprendi partita', en: 'Resume game' })
                  : t({ it: 'Gioca live', en: 'Play Game' })}
              </Button>
              <Button
                onClick={() => {
                  setMatchPlayedAt(toMatchDateValue());
                  ensureArenaMemberDecksLoaded();
                  setShowMatchModal(true);
                }}
                variant="outline"
                className="flex-1 border-emerald-500/35 bg-emerald-500/5 font-semibold text-foreground hover:bg-emerald-500/15"
              >
                <Target className="mr-2 h-4 w-4" />
                {t({ it: 'Registra partita', en: 'Record Battle' })}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={copyInviteLink}
                className="flex-1 border-border text-foreground"
              >
                <Copy className="mr-2 h-4 w-4" />
                {t({ it: 'Condividi invito', en: 'Share invite' })}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowInviteQr(true)} className="border-cyan-500/30 text-cyan-100">
                <QrCode className="mr-2 h-4 w-4" />
                QR
              </Button>
            </>
          )}
        >
          {activeLiveGameId ? (
            <button
              type="button"
              onClick={() => router.push(`/table/${groupId}/play`)}
              className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-3 text-left transition hover:bg-emerald-500/15"
            >
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm text-emerald-100">{t({ it: 'Partita live in corso', en: 'Live game in progress' })}</strong>
                <span className="block text-xs text-emerald-200/65">{t({ it: 'Tocca per tornare al tracker', en: 'Tap to return to the tracker' })}</span>
              </span>
              <ArrowLeft className="h-4 w-4 rotate-180 text-emerald-200" />
            </button>
          ) : null}
          {(canLeaveCurrentArena || canManageGroup) && (
            <div className="absolute right-4 top-4 hidden items-center gap-1 lg:flex">
              {canLeaveCurrentArena && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={openLeaveArenaModal}
                  disabled={membershipBusy}
                  className="h-10 w-10 text-muted-foreground hover:text-foreground"
                  title={t({ it: 'Esci dal playgroup', en: 'Leave playgroup' })}
                  aria-label={t({ it: 'Esci dal playgroup', en: 'Leave playgroup' })}
                >
                  <DoorOpen className="h-4 w-4" />
                </Button>
              )}
              {canManageGroup && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={openDeleteArenaModal}
                  disabled={membershipBusy}
                  className="h-10 w-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t({ it: 'Elimina playgroup', en: 'Delete playgroup' })}
                  aria-label={t({ it: 'Elimina playgroup', en: 'Delete playgroup' })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
          <p className="text-xs uppercase tracking-[0.24em] text-emerald-200">{t({ it: 'Sala operativa', en: 'Command room' })}</p>
          <div className="mt-1 flex min-w-0 items-center gap-2 lg:pr-24">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="break-words text-2xl font-bold text-foreground">{group.name}</h1>
              {canManageGroup && (
                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { if (group?.id === groupId) setArenaSettingsOwner(arenaSettingsContext); }} aria-label={t({ it: 'Modifica playgroup', en: 'Edit playgroup' })}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          {group.description ? <p className="text-sm text-muted-foreground">{group.description}</p> : null}
          <p className="font-mono text-xs font-semibold text-emerald-300">
            {t({ it: 'Invito', en: 'Invite' })}: {group.invite_code}
          </p>
        </PanelWithActions>

        {seasonContext ? (
          <Card className="mb-5 border-emerald-500/25 bg-emerald-950/15">
            <CardContent className="py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  {formatArenaSeasonLabel(
                    seasonContext.currentSeasonStart,
                    seasonContext.currentSeasonEnd,
                    language === 'it' ? 'it-IT' : 'en-US',
                  )}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatArenaSeasonDate(seasonContext.currentSeasonStart, language === 'it' ? 'it-IT' : 'en-US')}
                  {' – '}
                  {formatArenaSeasonDate(seasonContext.currentSeasonEnd, language === 'it' ? 'it-IT' : 'en-US')}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="mb-6 flex min-w-0 flex-col gap-3 rounded-2xl border border-border/70 bg-black/35 p-3 shadow-lg shadow-black/20 backdrop-blur-xl xl:flex-row xl:items-center xl:justify-between">
            <TabsList className="grid h-auto w-full min-w-0 grid-cols-5 gap-1 border border-border/70 bg-card/60 p-1 xl:inline-flex xl:h-11 xl:w-auto">
              <TabsTrigger
                value="matches"
                aria-label={t({ it: 'Partite', en: 'Battles' })}
                title={t({ it: 'Partite', en: 'Battles' })}
                className="h-9 min-w-0 px-1.5 text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 md:px-3 md:text-sm"
              >
                <Calendar className="h-4 w-4 shrink-0 md:mr-2" />
                <span className="hidden whitespace-nowrap md:inline">{t({ it: 'Partite', en: 'Battles' })}</span>
              </TabsTrigger>
              <TabsTrigger
                value="players"
                aria-label={t({ it: 'Giocatori', en: 'Players' })}
                title={t({ it: 'Giocatori', en: 'Players' })}
                className="h-9 min-w-0 px-1.5 text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 md:px-3 md:text-sm"
              >
                <Users className="h-4 w-4 shrink-0 md:mr-2" />
                <span className="hidden whitespace-nowrap md:inline">{t({ it: 'Giocatori', en: 'Players' })}</span>
              </TabsTrigger>
              <TabsTrigger
                value="commanders"
                aria-label={t({ it: 'Mazzi', en: 'Decks' })}
                title={t({ it: 'Mazzi', en: 'Decks' })}
                className="h-9 min-w-0 px-1.5 text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 md:px-3 md:text-sm"
              >
                <Swords className="h-4 w-4 shrink-0 md:mr-2" />
                <span className="hidden whitespace-nowrap md:inline">{t({ it: 'Mazzi', en: 'Decks' })}</span>
              </TabsTrigger>
              <TabsTrigger
                value="awards"
                aria-label="Awards"
                title="Awards"
                className="h-9 min-w-0 px-1.5 text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 md:px-3 md:text-sm"
              >
                <Award className="h-4 w-4 shrink-0 md:mr-2" />
                <span className="hidden whitespace-nowrap md:inline">Awards</span>
              </TabsTrigger>
              <TabsTrigger
                value="meta"
                aria-label={t({ it: 'Meta', en: 'Meta' })}
                title={t({ it: 'Meta', en: 'Meta' })}
                className="h-9 min-w-0 px-1.5 text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 md:px-3 md:text-sm"
              >
                <Palette className="h-4 w-4 shrink-0 md:mr-2" />
                <span className="hidden whitespace-nowrap md:inline">{t({ it: 'Meta', en: 'Meta' })}</span>
              </TabsTrigger>
            </TabsList>

            <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:w-auto xl:flex-wrap xl:justify-end">
              {activeTab === 'commanders' ? (
                <Select value={deckStatsSort} onValueChange={(value) => setDeckStatsSort(value as typeof deckStatsSort)}>
                  <SelectTrigger aria-label={t({ it: 'Ordina mazzi', en: 'Sort decks' })} className="h-11 w-full min-w-0 bg-card/70 border-border text-foreground xl:min-w-[11rem]">
                    <SelectValue placeholder={t({ it: 'Ordina per', en: 'Sort by' })} />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="winRate">{t({ it: 'Win rate', en: 'Win rate' })}</SelectItem>
                    <SelectItem value="gamesPlayed">{t({ it: 'Partite giocate', en: 'Games played' })}</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              {activeTab === 'commanders' || activeTab === 'meta' ? (
                <Select value={bracketFilter} onValueChange={setBracketFilter}>
                  <SelectTrigger aria-label={t({ it: 'Filtra per bracket', en: 'Filter by bracket' })} className="h-11 w-full min-w-0 bg-card/70 border-border text-foreground xl:min-w-[10rem]">
                    <SelectValue placeholder={t({ it: 'Bracket', en: 'Bracket' })} />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="all">{t({ it: 'Tutti i bracket', en: 'All Brackets' })}</SelectItem>
                    {bracketOptions.map((bracket) => (
                      <SelectItem key={bracket} value={bracket}>
                        {t({ it: 'Bracket', en: 'Bracket' })} {bracket}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {activeTab !== 'awards' ? (
                <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as typeof dateFilter)}>
                  <SelectTrigger aria-label={t({ it: 'Periodo partite', en: 'Match period' })} className="h-11 w-full min-w-0 bg-card/70 border-border text-foreground xl:min-w-[10rem]">
                    <Calendar className="mr-2 h-4 w-4 shrink-0" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="all">{t({ it: 'Season corrente', en: 'Current season' })}</SelectItem>
                    <SelectItem value="7d">{t({ it: 'Ultimi 7 giorni', en: 'Last 7 Days' })}</SelectItem>
                    <SelectItem value="30d">{t({ it: 'Ultimi 30 giorni', en: 'Last 30 Days' })}</SelectItem>
                    <SelectItem value="90d">{t({ it: 'Ultimi 90 giorni', en: 'Last 90 Days' })}</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>

          <ArenaHistoryPanel season={season} history={history} seasonContext={seasonContext}
            matchDayGroups={matchDayGroups} expandedDayKeys={expandedDayKeys} toggleDayGroup={toggleDayGroup}
            onCreateMatch={() => {
              setMatchPlayedAt(toMatchDateValue());
              ensureArenaMemberDecksLoaded();
              setShowMatchModal(true);
            }}
            actions={{ openDayExportModal, setDetailsMatch, handleShareMatch, openEditMatch, deletingMatch, handleDeleteMatch }} />

          <ArenaAwardsPanel status={reportPanelStatus}
            awardsView={awardsView} setAwardsView={setAwardsView} arenaAwards={arenaAwards} arenaAwardGroups={arenaAwardGroups} playerAwards={playerAwards} />

          <TabsContent value="players">
            <div className="space-y-6">
              <ArenaPlayerReport status={reportPanelStatus} playerStats={playerStats}
                playerRanksByIndex={playerRanksByIndex} totalMatches={analyticsPayload.totalMatches}
                guests={guests} canManageGroup={canManageGroup} guestDeletion={{ deletingGuestIds, handleDeleteGuest }} />

                <ArenaMemberRoster members={members} group={group} userId={user?.id ?? null}
                  adminMode={adminMode} canManageGroup={canManageGroup}
                  controls={{ membershipBusy, kickingMemberIds, handleKickMember }} />

                {canManageGroup && (
                  <Card className="bg-card/50 border-border">
                    <CardHeader><CardTitle>{t({it:'Guest e mazzi del playgroup',en:'Playgroup guests and decks'})}</CardTitle>
                      <CardDescription>{t({it:'Trova un guest o un comandante e gestisci i mazzi associati.',en:'Find a guest or commander and manage their decks.'})}</CardDescription>
                    </CardHeader>
                    <CardContent>{!guestsError && <GuestDirectory key={`${user?.id}:${groupId}`} guests={guests} deletingIds={deletingGuestIds}
                      onAdd={()=>openGuestModal('manage-create')}
                      onAddDeck={openAddGuestDeckModal} onDelete={handleDeleteGuest} />}</CardContent>
                  </Card>
                )}
            </div>
          </TabsContent>

          <ArenaDeckRankingsPanel status={reportPanelStatus}
            deckStats={deckStats} visibleDeckStats={visibleDeckStats} deckStatsSort={deckStatsSort} provisionalDeckCount={provisionalDeckCount} showProvisionalDecks={showProvisionalDecks} setShowProvisionalDecks={setShowProvisionalDecks} commanderRanksByIndex={commanderRanksByIndex} />

          <ArenaMetaPanel status={reportPanelStatus}
            analyticsPayload={analyticsPayload} colorAnalytics={colorAnalytics} syncingDeckColors={syncingDeckColors} />
        </Tabs>

        {(canLeaveCurrentArena || canManageGroup) && (
          <Card className="mt-6 border-border/70 bg-card/65 lg:hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-foreground">
                {t({ it: 'Gestione playgroup', en: 'Playgroup management' })}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {canLeaveCurrentArena && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={openLeaveArenaModal}
                  disabled={membershipBusy}
                  className="h-11 justify-start border-border text-foreground"
                >
                  <DoorOpen className="mr-2 h-4 w-4" />
                  {t({ it: 'Esci dal playgroup', en: 'Leave playgroup' })}
                </Button>
              )}
              {canManageGroup && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={openDeleteArenaModal}
                  disabled={membershipBusy}
                  className="h-11 justify-start border-destructive/35 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t({ it: 'Elimina playgroup', en: 'Delete playgroup' })}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <ArenaMatchCreateDialog groupId={groupId} members={members} guests={guests} form={matchCreation}
        anyOccasionalCreationBusy={anyOccasionalCreationBusy} setOccasionalCreationBusy={setOccasionalCreationBusy}
        setOccasionalChoices={setOccasionalChoices} openGuestModal={openGuestModal}
        getParticipantDeckOptions={getParticipantDeckOptions} getFilteredParticipantDeckOptions={getFilteredParticipantDeckOptions}
        getSelectedParticipantDeck={getSelectedParticipantDeck} />

      {activeExportDayKey && (
        <ModalOverlay>
          <ModalCard>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Download className="h-5 w-5" />
                {t({ it: 'Export partite', en: 'Export matches' })}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {matchDayGroups.find((entry) => entry.dayKey === exportDayKey)?.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dayExport.loading?<p role="status">{t({it:'Caricamento export completo…',en:'Loading complete export…'})}</p>:null}
              {dayExport.error?<div role="alert"><p>{t({it:'Export non disponibile. Nessun testo parziale viene condiviso.',en:'Export unavailable. Partial text will not be shared.'})}</p><Button variant="outline" onClick={dayExport.retry}>{t({it:'Riprova',en:'Retry'})}</Button></div>:null}
              {dayExport.ready?<p className="mb-3 text-sm text-muted-foreground">{t({it:dayExport.matches.length+' partite nel periodo · export completo',en:dayExport.matches.length+' matches in period · complete export'})}</p>:null}
              <RichTextEditor
                label={t({ it: 'Intro', en: 'Intro' })}
                value={exportIntro}
                onChange={setExportIntro}
                placeholder={t({
                  it: 'Scrivi l\'intro del post...',
                  en: 'Write the post intro...',
                })}
                hint={t({
                  it: 'Usa la barra formato per grassetto, corsivo, barrato, a capo ed elenchi.',
                  en: 'Use the format toolbar for bold, italic, strike, line breaks, and bullet lists.',
                })}
                minRows={4}
              />
            </CardContent>
            <div className="shrink-0 border-t border-border/70 bg-card px-6 py-4">
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDayExportModal}
                  className="flex-1 border-border text-foreground"
                >
                  {t({ it: 'Annulla', en: 'Cancel' })}
                </Button>
                <Button
                  type="button"
                  disabled={!dayExport.ready || dayExport.matches.length===0}
                  onClick={() => void handleExportDayMatches()}
                  className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                >
                  {t({ it: 'Genera export', en: 'Generate export' })}
                </Button>
              </div>
            </div>
          </ModalCard>
        </ModalOverlay>
      )}

      {arenaSettingsOwner && arenaSettingsOwner === arenaSettingsContext && group?.id === groupId && (
        <ArenaSettingsEditor
          key={arenaSettingsOwner}
          group={group}
          seasonResetMonth={seasonContext?.resetMonth}
          reloadSeason={season.reload}
          onClose={() => setArenaSettingsOwner(null)}
          onSaved={(update) => {
            setArenaSettingsOwner(null);
            setGroup((currentGroup) => currentGroup?.id === group.id ? { ...currentGroup, ...update } : currentGroup);
          }}
        />
      )}

      <ArenaRecapDialog recap={recap} />
      <ArenaMembershipDialogs group={group} controls={membership} />

      {/* Edit Match Modal */}
      <ArenaMatchDetailsDialog controls={matchDetails} groupName={group.name} getWinConditionLabel={getWinConditionLabel} />

      {group ? <ArenaInviteQrDialog
        open={showInviteQr}
        inviteCode={group.invite_code}
        arenaName={group.name}
        onClose={() => setShowInviteQr(false)}
        labels={{
          title: t({ it: 'QR Playgroup', en: 'Playgroup QR' }),
          hint: t({ it: 'Scansiona per entrare in questo playgroup.', en: 'Scan to join this playgroup.' }),
          close: t({ it: 'Chiudi', en: 'Close' }),
        }}
      /> : null}

      <ArenaMatchEditDialog groupId={groupId} form={matchEditor} canManageGroup={canManageGroup}
        anyOccasionalCreationBusy={anyOccasionalCreationBusy} setOccasionalChoices={setOccasionalChoices}
        setOccasionalCreationBusy={setOccasionalCreationBusy} getParticipantDeckOptions={getParticipantDeckOptions} />

      <ArenaGuestDialog key={guestCommands.dialogKey} guests={guests} controls={guestCommands} />
    </div>
  );
}
