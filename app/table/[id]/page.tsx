'use client';
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
import {useArenaDayExport} from '@/hooks/use-arena-day-export';

import {useArenaSeasonContext} from '@/hooks/use-arena-season-context';
import {ArenaHistoryPagination} from '@/components/arena/arena-history-pagination';
import {ArenaDataStatus} from '@/components/arena/arena-data-status';

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
import { DeckImage } from '@/components/deck-image';

import { ArenaInviteQrDialog } from '@/components/arena/arena-invite-qr-dialog';
import { PreviousSeasonsPanel } from '@/components/arena/previous-seasons-panel';
import { useLanguage } from '@/components/language-provider';
import { usePlatformAdmin } from '@/hooks/use-platform-admin';

import { MANA_COLOR_LABELS } from '@/lib/mana-colors';

import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';

import { PanelWithActions } from '@/components/ui/panel-with-actions';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FormattedMarkdown } from '@/components/ui/formatted-markdown';
import { RichTextEditor } from '@/components/ui/rich-text-editor';

import { buildArenaShareText } from '@/lib/arena-share';
import { canLeaveArena, isArenaMember } from '@/lib/arena-membership';
import { isDemoUser } from '@/lib/demo';
import { getParticipantDeckId, getParticipantDeckSnapshot, getParticipantDisplayName, type ArenaGuestDeck } from '@/lib/arena-participants';

import { getProfileDisplayName } from '@/lib/profile-display';

import { formatGameDuration } from '@/lib/live-game-duration';

import { groupMatchesByDay } from '@/lib/arena-session';
import {
  buildArenaSessionExportText,
  type ArenaSessionExportMatch,
} from '@/lib/arena-session-export';

import {
  formatArenaSeasonDate,
  formatArenaSeasonLabel,
} from '@/lib/arena-seasons';

import { toMatchDateValue } from '@/lib/match-datetime';
import { parseParticipantKey, type ParticipantKey } from '@/lib/participant-keys';

import { format, parse } from 'date-fns';
import { enUS, it as itLocale } from 'date-fns/locale';
import { Swords, ArrowLeft, Users, Trophy, Trash2, Copy, Calendar, ChevronDown, Download, Target, Skull, Pencil, Eye, Share2, Palette, DoorOpen, Award, Flame, Crown, QrCode, Shield, Flag } from 'lucide-react';

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
  const [expandedDayKeys, setExpandedDayKeys] = useState<Set<string>>(new Set());
  const [exportDayKey, setExportDayKey] = useState<string | null>(null);
  const [exportIntro, setExportIntro] = useState('');
  const [exportDayOwner,setExportDayOwner]=useState<string|null>(null);
  const reportOwnerKey=user?user.id+':'+groupId:null;
  const activeExportDayKey=exportDayOwner===reportOwnerKey?exportDayKey:null;
  const dayExport=useArenaDayExport(user?.id,history.scope,activeExportDayKey);
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

  const matchDayGroups=useMemo(()=>groupMatchesByDay(matches,{
    formatLabel:dayKey=>format(parse(dayKey,'yyyy-MM-dd',new Date()),'d MMM yyyy',{locale:language==='it'?itLocale:enUS}),
    unknownDateLabel:t({it:'Data non disponibile',en:'Date unavailable'}),
  }),[matches,language,t]);

  const latestDayKey = matchDayGroups[0]?.dayKey ?? null;

  useEffect(() => {
    if (!latestDayKey) {
      setExpandedDayKeys(new Set());
      return;
    }

    setExpandedDayKeys((current) => {
      if (current.size === 0) {
        return new Set([latestDayKey]);
      }

      const next = new Set(current);
      next.add(latestDayKey);
      return next;
    });

  }, [latestDayKey]);

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

  const copyInviteLink = () => {
    if (!group) return;
    navigator.clipboard.writeText(`${window.location.origin}/join/${group.invite_code}`);
    toast({
      title: t({ it: 'Copiato!', en: 'Copied!' }),
      description: t({ it: 'Link invito copiato negli appunti', en: 'Invite link copied to clipboard' }),
    });
  };

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

  const getMatchWinnerName = (match: Match) => {
    if (match.winner_guest?.display_name) return match.winner_guest.display_name;
    return getProfileDisplayName(match.winner);
  };

  const getWinConditionLabel = (condition: Match['win_condition']) => {
    if (condition === 'last_standing') return t({ it: 'Ultimo in piedi', en: 'Last standing' });
    if (condition === 'combo') return 'Combo';
    if (condition === 'concession') return t({ it: 'Resa', en: 'Concession' });
    if (condition === 'alternate_card') return t({ it: 'Vittoria alternativa', en: 'Alternate card' });
    if (condition === 'other') return t({ it: 'Altro', en: 'Other' });
    return t({ it: 'Non indicata', en: 'Not specified' });
  };

  const buildMatchShareText = (match: Match) => {
    const participants = match.match_participants
      .map((participant) => {
        const playerName = getParticipantDisplayName(participant);
        const deck = getParticipantDeckSnapshot(participant);
        const deckName = deck?.name || t({ it: 'Mazzo non indicato', en: 'No deck selected' });
        const commanderName = deck?.commander ? ` (${deck.commander})` : '';
        return `- ${playerName}: ${deckName}${commanderName}`;
      })
      .join('\n');
    const winnerName = match.is_draw
      ? t({ it: 'Patta', en: 'Draw' })
      : getMatchWinnerName(match);
    const comment = match.notes?.trim() || t({ it: 'Nessun commento', en: 'No comment' });

    return [
      `${t({ it: 'Partita 21Life', en: '21Life match' })} - ${group?.name || ''}`,
      match.played_at ? format(new Date(match.played_at), 'PPP') : t({it:'Data non disponibile',en:'Date unavailable'}),
      match.duration_seconds != null
        ? `${t({ it: 'Durata', en: 'Duration' })}: ${formatGameDuration(match.duration_seconds)}`
        : null,
      match.win_condition
        ? `${t({ it: 'Condizione di vittoria', en: 'Win condition' })}: ${getWinConditionLabel(match.win_condition)}`
        : null,
      '',
      t({ it: 'Partecipanti e mazzi:', en: 'Players and decks:' }),
      participants,
      '',
      `${t({ it: 'Vincitore', en: 'Winner' })}: ${winnerName}`,
      '',
      `${t({ it: 'Commento', en: 'Comment' })}:`,
      comment,
      ...(match.tracking_version || match.duration_seconds != null ? [
        '',
        t({ it: 'Statistiche realtime:', en: 'Realtime stats:' }),
        ...match.match_participants.map((participant) => (
          `- ${getParticipantDisplayName(participant)}: ${participant.life_damage_dealt || 0} dmg · ${participant.eliminations_caused || 0} KO`
        )),
      ] : []),
    ].filter((line): line is string => line !== null).join('\n');
  };

  const getPeriodLabel = () => {
    if (dateFilter === '7d') return t({ it: 'Ultimi 7 giorni', en: 'Last 7 days' });
    if (dateFilter === '30d') return t({ it: 'Ultimi 30 giorni', en: 'Last 30 days' });
    if (dateFilter === '90d') return t({ it: 'Ultimi 90 giorni', en: 'Last 90 days' });
    return seasonContext
      ? formatArenaSeasonLabel(
          seasonContext.currentSeasonStart,
          seasonContext.currentSeasonEnd,
          language === 'it' ? 'it-IT' : 'en-US',
        )
      : t({ it: 'Tutto il periodo', en: 'All time' });
  };

  const handleShareArenaStats = async () => {
    if (!group || !season.ready || !reportAnalytics.ready || history.loading || history.error) return;

    const filteredMatches = history.recentMatches as unknown as Match[];
    const text = buildArenaShareText({
      arenaName: group.name,
      periodLabel: getPeriodLabel(),
      totalMatches: analyticsPayload.totalMatches ?? 0,
      topPlayers: playerStats.slice(0, 5).map((player) => ({
        displayName: player.displayName,
        gamesPlayed: player.gamesPlayed,
        wins: player.wins,
        losses: player.losses,
        draws: player.draws,
        decisiveGames: player.decisiveGames,
        winRate: player.winRate,
      })),
      topDecks: deckStats.slice(0, 5).map((deck) => ({
        name: deck.name,
        commander: deck.commander,
        ownerDisplayName: deck.ownerDisplayName,
        gamesPlayed: deck.gamesPlayed,
        wins: deck.wins,
        losses: deck.losses,
        draws: deck.draws,
        decisiveGames: deck.decisiveGames,
        winRate: deck.winRate,
        bracket: deck.bracket,
      })),
      topColors: colorAnalytics.played.slice(0, 5).map((entry) => ({
        label: t(MANA_COLOR_LABELS[entry.color] || MANA_COLOR_LABELS.C),
        gamesPlayed: entry.appearances,
        percentage: entry.percentage,
      })),
      recentMatches: filteredMatches.slice(0, 3).map((match) => ({
        playedAt: match.played_at,
        notes: match.notes,
        winnerName: getMatchWinnerName(match),
        participants: match.match_participants.map((participant) => {
          const deck = getParticipantDeckSnapshot(participant);
          return {
            displayName: getParticipantDisplayName(participant),
            commander: deck?.commander || null,
            deckName: deck?.name || null,
            isWinner: participant.is_winner,
            bracket: deck?.bracket || null,
          };
        }),
      })),
      publicUrl: group.is_public ? `${window.location.origin}/arena/${group.invite_code}` : null,
    }, {
      arenaStatsTitle: t({ it: 'Statistiche playgroup', en: 'Playgroup stats' }),
      period: t({ it: 'Periodo', en: 'Period' }),
      totalMatches: t({ it: 'Partite', en: 'Matches' }),
      topPlayers: t({ it: 'Top giocatori', en: 'Top players' }),
      topDecks: t({ it: 'Top mazzi', en: 'Top decks' }),
      topColors: t({ it: 'Colori più giocati', en: 'Most played colors' }),
      recentMatches: t({ it: 'Ultime partite', en: 'Recent matches' }),
      winner: t({ it: 'Vincitore', en: 'Winner' }),
      winRate: t({ it: 'win rate', en: 'win rate' }),
      publicPage: t({ it: 'Pagina pubblica', en: 'Public page' }),
      noComment: t({ it: 'Nessun commento', en: 'No comment' }),
    });

    try {
      if (navigator.share) {
        await navigator.share({
          title: `${group.name} - 21Life`,
          text,
        });
        return;
      }

      await navigator.clipboard.writeText(text);
      toast({
        title: t({ it: 'Statistiche copiate', en: 'Stats copied' }),
        description: t({ it: 'Il riepilogo del playgroup è negli appunti', en: 'Playgroup summary copied to clipboard' }),
      });
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Impossibile condividere le statistiche', en: 'Unable to share stats' }),
        variant: 'destructive',
      });
    }
  };

  const toggleDayGroup = (dayKey: string, open: boolean) => {
    setExpandedDayKeys((current) => {
      const next = new Set(current);
      if (open) {
        next.add(dayKey);
      } else {
        next.delete(dayKey);
      }
      return next;
    });
  };

  const buildSessionExportMatch = (match: Match): ArenaSessionExportMatch => ({
    participants: match.match_participants.map((participant) => {
      const deck = getParticipantDeckSnapshot(participant);
      const commanderLabel = deck?.commander?.trim() || deck?.name?.trim() || '—';
      return {
        displayName: getParticipantDisplayName(participant),
        commanderLabel,
      };
    }),
    notes: match.notes,
  });

  const openDayExportModal = (dayKey: string) => {
    setExportDayOwner(reportOwnerKey);
    setExportDayKey(dayKey);
    setExportIntro('');
  };

  const closeDayExportModal = () => {
    setExportDayOwner(null);
    setExportDayKey(null);
    setExportIntro('');
  };

  const handleExportDayMatches = async () => {
    if(!activeExportDayKey || !dayExport.ready)return;
    const dayMatches=dayExport.matches as unknown as Match[];
    if(!dayMatches.length)return;

    const dayGroup = matchDayGroups.find((entry) => entry.dayKey === activeExportDayKey);
    const exportMatches = [...dayMatches]
      .reverse()
      .map((match) => buildSessionExportMatch(match));
    const text = buildArenaSessionExportText(exportIntro, exportMatches);

    try {
      if (navigator.share) {
        await navigator.share({
          title: dayGroup?.label || activeExportDayKey,
          text,
        });
        closeDayExportModal();
        return;
      }

      await navigator.clipboard.writeText(text);
      toast({
        title: t({ it: 'Export copiato', en: 'Export copied' }),
        description: t({
          it: 'Il testo del giorno è negli appunti.',
          en: 'The day export is in your clipboard.',
        }),
      });
      closeDayExportModal();
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(text);
        toast({
          title: t({ it: 'Export copiato', en: 'Export copied' }),
          description: t({
            it: 'Il testo del giorno è negli appunti.',
            en: 'The day export is in your clipboard.',
          }),
        });
        closeDayExportModal();
      } catch {
        toast({
          title: t({ it: 'Errore', en: 'Error' }),
          description: t({ it: 'Impossibile esportare le partite', en: 'Unable to export matches' }),
          variant: 'destructive',
        });
      }
    }
  };

  const handleShareMatch = async (match: Match) => {
    const text = buildMatchShareText(match);
    const shareData = {
      title: t({ it: 'Log partita 21Life', en: '21Life match log' }),
      text,
    };

    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        return;
      }

      await navigator.clipboard.writeText(text);
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      toast({
        title: t({ it: 'Log copiato', en: 'Log copied' }),
        description: t({ it: 'Ho aperto WhatsApp con il testo pronto da inviare.', en: 'WhatsApp opened with the match text ready.' }),
      });
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(text);
        toast({
          title: t({ it: 'Log copiato', en: 'Log copied' }),
          description: t({ it: 'Il testo della partita è negli appunti.', en: 'The match text is in your clipboard.' }),
        });
      } catch {
        toast({
          title: t({ it: 'Errore', en: 'Error' }),
          description: t({ it: 'Impossibile condividere il log partita', en: 'Unable to share match log' }),
          variant: 'destructive',
        });
      }
    }
  };

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
              <Button variant="outline" size="sm" onClick={handleShareArenaStats} disabled={!season.ready || !reportAnalytics.ready || history.loading || Boolean(history.error)} className="h-11 border-border px-3 text-foreground sm:px-4" title={t({ it: 'Condividi statistiche', en: 'Share stats' })}>
                <Share2 className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">{t({ it: 'Condividi', en: 'Share' })}</span>
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

          <TabsContent value="matches">
            <ArenaDataStatus loading={season.loading} error={season.error} onRetry={season.reload}>
            <ArenaHistoryPagination loading={history.loading} error={history.error} total={history.total} from={history.from} to={history.to}
              canGoNext={history.canGoNext} canGoPrevious={history.canGoPrevious} onNext={history.next} onPrevious={history.previous} onRetry={history.retry} />
            {!history.loading && !history.error && history.total === 0 ? (
              <Card className="phyrexian-panel">
                <CardContent className="py-12 text-center">
                  <Skull className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">{t({ it: 'Nessuna partita', en: 'No battles yet' })}</h3>
                  <p className="text-muted-foreground mb-4">{t({ it: 'Registra la prima partita per iniziare a tracciare i risultati', en: 'Record your first battle to begin tracking' })}</p>
                  <Button
                    onClick={() => {
                      setMatchPlayedAt(toMatchDateValue());
                      ensureArenaMemberDecksLoaded();
                      setShowMatchModal(true);
                    }}
                    className="bg-gradient-to-r from-emerald-600 to-teal-700"
                  >
                    <Target className="w-4 h-4 mr-2" /> {t({ it: 'Registra la prima partita', en: 'Record First Battle' })}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {matchDayGroups.map((dayGroup) => {
                  const isExpanded = expandedDayKeys.has(dayGroup.dayKey);
                  return (
                    <Collapsible
                      key={dayGroup.dayKey}
                      open={isExpanded}
                      onOpenChange={(open) => toggleDayGroup(dayGroup.dayKey, open)}
                    >
                      <Card className="phyrexian-panel overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              <span className="font-medium text-foreground">{dayGroup.label}</span>
                              <span className="text-sm text-muted-foreground">
                                · {dayGroup.matchCount}{' '}
                                {t({
                                  it: dayGroup.matchCount === 1 ? 'partita' : 'partite',
                                  en: dayGroup.matchCount === 1 ? 'match' : 'matches',
                                })}
                              </span>
                            </button>
                          </CollapsibleTrigger>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 border-border/80 bg-background/40"
                            onClick={() => openDayExportModal(dayGroup.dayKey)}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            {t({ it: 'Export', en: 'Export' })}
                          </Button>
                        </div>
                        <CollapsibleContent>
                          <div className="space-y-3 p-3">
                            {dayGroup.matches.length === 0 && isExpanded ? (
                              <p className="py-4 text-center text-sm text-muted-foreground">
                                {t({ it: 'Nessuna partita in questa giornata', en: 'No matches on this day' })}
                              </p>
                            ) : null}
                            {dayGroup.matches.map((match) => (
                              <Card key={match.id} className="border-border/70 bg-background/20 transition-colors hover:border-emerald-500/40">
                                <CardContent className="py-4">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0 flex-1">
                                      <div className="mb-3 flex flex-col gap-2">
                                        {match.match_participants.map((p) => {
                                          const deck = getParticipantDeckSnapshot(p);
                                          const displayName = getParticipantDisplayName(p);
                                          return (
                                            <div
                                              key={p.id}
                                              className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm ${
                                                p.is_winner
                                                  ? 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
                                                  : 'bg-secondary/80 text-secondary-foreground'
                                              }`}
                                            >
                                              <DeckImage
                                                src={deck?.commander_image}
                                                alt={deck?.commander || displayName}
                                                className="h-[4.5rem] w-[3.25rem] shrink-0 rounded object-cover object-top"
                                                fallbackClassName="h-[4.5rem] w-[3.25rem] shrink-0 rounded"
                                              />
                                              <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                  {p.is_winner && <Trophy className="h-3.5 w-3.5 shrink-0" />}
                                                  {p.is_winner && match.win_condition === 'last_standing' ? <Shield className="h-3.5 w-3.5 shrink-0" /> : null}
                                                  {p.is_winner && match.win_condition === 'combo' ? <Flame className="h-3.5 w-3.5 shrink-0" /> : null}
                                                  {p.is_winner && match.win_condition === 'concession' ? <Flag className="h-3.5 w-3.5 shrink-0" /> : null}
                                                  {p.is_winner && match.win_condition === 'alternate_card' ? <Crown className="h-3.5 w-3.5 shrink-0" /> : null}
                                                  {p.is_winner && match.win_condition === 'other' ? <Target className="h-3.5 w-3.5 shrink-0" /> : null}
                                                  <span className="font-semibold">{displayName}</span>
                                                  {deck?.bracket && (
                                                    <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300">
                                                      B{deck.bracket}
                                                    </span>
                                                  )}
                                                </div>
                                                {deck?.name ? (
                                                  <p className="mt-0.5 line-clamp-1 text-sm font-medium text-foreground">{deck.name}</p>
                                                ) : null}
                                                {deck?.commander ? (
                                                  <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{deck.commander}</p>
                                                ) : null}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      {match.is_draw ? (
                                        <span className="mb-2 inline-flex rounded-full border border-slate-400/40 bg-slate-500/15 px-2.5 py-0.5 text-xs font-medium text-slate-200">
                                          {t({ it: 'Patta', en: 'Draw' })}
                                        </span>
                                      ) : null}
                                      {match.notes ? <FormattedMarkdown value={match.notes} className="italic" /> : null}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {(match.tracking_version || match.duration_seconds != null) ? (
                                        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-cyan-300" onClick={() => setDetailsMatch(match)} title={t({ it: 'Dettagli tracking', en: 'Tracking details' })}>
                                          <Eye className="h-4 w-4" />
                                          <span className="hidden lg:inline">{t({ it: 'Dettagli', en: 'Details' })}</span>
                                        </Button>
                                      ) : null}
                                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-emerald-300" onClick={() => handleShareMatch(match)} title={t({ it: 'Condividi log', en: 'Share log' })}>
                                        <Share2 className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => openEditMatch(match)}>
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" disabled={deletingMatch} onClick={() => handleDeleteMatch(match.id)}>
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  );
                })}
              </div>
            )}
            {seasonContext ? <PreviousSeasonsPanel archives={seasonContext.archives} /> : null}

            </ArenaDataStatus>
</TabsContent>

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
