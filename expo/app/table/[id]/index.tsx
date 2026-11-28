import { useArenaMatchFormCommand } from '@/hooks/use-arena-match-form-command';
import { getArenaMatchWriteFailureMessage } from '../../../../packages/domain/arena-match-write';
import {useArenaAnalytics} from '@/hooks/use-arena-analytics';
import {useArenaSeasonContext} from '@/hooks/use-arena-season-context';
import {ArenaAnalyticsStatus} from '@/components/table/arena-analytics-status';
import {useArenaDayExport} from '@/hooks/use-arena-day-export';
import {arenaHistoryScope} from '../../../../packages/domain/arena-history';
import {ArenaHistoryStatus} from '@/components/table/arena-history-status';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showAppAlert, type AppAlert, type AppAlertButton } from '@/lib/app-alert';
import { GuestDialogHost } from '@/components/table/guest-dialog-host';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { AddGuestModal, type GuestModalMode } from '@/components/table/add-guest-modal';
import { EditMatchModal } from '@/components/table/edit-match-modal';
import { MatchDetailsModal } from '@/components/table/match-details-modal';
import { ArenaInviteQrModal } from '@/components/table/arena-invite-qr-modal';
import { ArenaFilterPanel } from '@/components/table/arena-filter-panel';
import { ArenaTabBar } from '@/components/table/arena-tab-bar';
import { ArenaCommandPanel } from '@/components/table/arena-command-panel';
import { ArenaSeasonSettings } from '@/components/table/arena-season-settings';
import { PreviousSeasonsPanel } from '@/components/table/previous-seasons-panel';
import { TableArenaManagement } from '@/components/table/table-arena-management';
import { TableDecksTab } from '@/components/table/table-decks-tab';
import { TableGuestsSection } from '@/components/table/table-guests-section';
import { TableMatchesList } from '@/components/table/table-matches-list';
import { TableMetaTab } from '@/components/table/table-meta-tab';
import { TableAwardsTab } from '@/components/table/table-awards-tab';
import { PlayerAwardsTab } from '@/components/table/player-awards-tab';
import { TablePlayersTab } from '@/components/table/table-players-tab';
import { TableUserManagement } from '@/components/table/table-user-management';
import { RecordMatchModal } from '@/components/table/record-match-modal';
import { PhyrexianPanel } from '@/components/ui/phyrexian-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextInput } from '@/components/ui/rich-text-input';
import { ArenaSkeleton } from '@/components/ui/screen-skeletons';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { SharePreviewModal } from '@/components/ui/share-preview-modal';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/language-context';
import { colors, spacing } from '@/constants/theme';
import { useArena } from '@/hooks/use-arena';
import { useScreenInsets } from '@/hooks/use-screen-insets';
import { useToast } from '@/contexts/toast-context';
import { hapticSuccess } from '@/lib/haptics';
import { type DeckStatsSort } from '@/lib/arena-deck-stats';
import {
  getArenaAnalyticsSince,
  buildArenaAnalyticsView,
  createEmptyArenaAnalyticsView,
} from '@/lib/arena-analytics-bundle';
import {
  filterMatchesByDate,
  filterMatchesByBracket,
  type ArenaDateFilter,
} from '@/lib/arena-filters';
import { canKickArenaMember, canLeaveArena, canManageArenaMembership, isArenaMember } from '@/lib/arena-membership';
import { getParticipantDeckSnapshot, getParticipantDisplayName } from '@/lib/arena-participants';
import {
  buildArenaSessionExportText,
  type ArenaSessionExportMatch,
} from '@/lib/arena-session-export';
import { buildMatchShareText } from '@/lib/arena-match-share';
import { groupMatchesByDay } from '@/lib/arena-session';
import { useNativeArenaRecap } from '@/hooks/use-native-arena-recap';
import { ArenaRecapDialog } from '@/components/table/arena-recap-dialog';
import { buildPlayerAwardsFromAggregates } from '@/lib/player-awards';
import { apiPost } from '@/lib/api';
import { isLeaveArenaConfirmationValid } from '@/lib/leave-arena-confirm';

import { fetchActiveLiveGame, fetchLiveGameByMatchId } from '@/lib/live-game-service';
import type { LiveGameRecord } from '@/lib/live-game';
import { toUserParticipantKey } from '@/lib/participant-keys';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { supabase } from '@/lib/supabase';
import type { ArenaMatch } from '@/lib/types/arena';
import {
  formatArenaSeasonDate,
  formatArenaSeasonLabel,
  setArenaSeasonSettings,
} from '@/lib/arena-seasons';

type ArenaTab = 'matches' | 'players' | 'decks' | 'awards' | 'meta';

const DATE_FILTERS: ArenaDateFilter[] = ['all', '7d', '30d', '90d'];

const DATE_FILTER_KEYS = {
  all: 'currentSeason',
  '7d': 'filter7d',
  '30d': 'filter30d',
  '90d': 'filter90d',
} as const;

const DECK_SORT_KEYS: Record<DeckStatsSort, 'deckSortWinRate' | 'deckSortGamesPlayed'> = {
  winRate: 'deckSortWinRate',
  gamesPlayed: 'deckSortGamesPlayed',
};

export default function TableScreen() {
  const { id, matchId } = useLocalSearchParams<{ id: string; matchId?: string }>();
  const groupId = Array.isArray(id) ? id[0] : id;
  const { user, session } = useAuth();
  const { copy, language } = useLanguage();
  const router = useRouter();

  const {
    group,
    members,
    matches,
    hasMoreMatches,
    loadingMoreMatches,
    historyRevision,historyTotal,historyLoading,historyError,historyCached,retryHistory,arenaError,
    guests,
    decks,
    loading,
    refresh,
    loadMoreMatches,
    createMatch,
    updateGroup,
    updateMatch,
    kickMember,
    deleteArena,
    leaveArena,
    deleteMatch,
    addGuest,
    addGuestDeck,
    removeGuest,
  } = useArena(groupId, user?.id);
  const recap = useNativeArenaRecap(user?.id ?? '', groupId ?? '', group?.name ?? '', session);

  const [activeTab, setActiveTab] = useState<ArenaTab>('matches');
  const [awardsView, setAwardsView] = useState<'players' | 'decks'>('decks');
  const { scrollContentStyle } = useScreenInsets();
  const { showToast } = useToast();
  const [dateFilter, setDateFilter] = useState<ArenaDateFilter>('all');
  const [bracketFilter, setBracketFilter] = useState('all');
  const [deckStatsSort, setDeckStatsSort] = useState<DeckStatsSort>('winRate');
  const [refreshing, setRefreshing] = useState(false);
  const [activeLiveGameId, setActiveLiveGameId] = useState<string | null>(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [guestModalMode, setGuestModalMode] = useState<GuestModalMode | undefined>(undefined);
  const [guestModalTargetId, setGuestModalTargetId] = useState<string | null>(null);
  const [savingGuest, setSavingGuest] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showGuestsManager, setShowGuestsManager] = useState(false);
  const [guestAlert, setGuestAlert] = useState<Omit<AppAlert, 'id'> | null>(null);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showInviteQr, setShowInviteQr] = useState(false);
  const [editingMatch, setEditingMatch] = useState<ArenaMatch | null>(null);
  const [detailsMatch, setDetailsMatch] = useState<ArenaMatch | null>(null);
  const notificationPage = useRef('');
  useEffect(() => {
    if (!matchId || loading) return;
    const target = matches.find((match) => match.id === matchId);
    if (target) { setActiveTab('matches'); setDetailsMatch(target); router.setParams({ matchId: undefined }); }
    else if (hasMoreMatches && !loadingMoreMatches && notificationPage.current !== `${matchId}:${matches.length}`) { notificationPage.current = `${matchId}:${matches.length}`; void loadMoreMatches(); }
  }, [matchId, loading, matches, hasMoreMatches, loadingMoreMatches, loadMoreMatches, router]);
  const [detailsLiveGame, setDetailsLiveGame] = useState<LiveGameRecord | null>(null);
  const [detailsRecapLoading, setDetailsRecapLoading] = useState(false);
  const [exportSelection,setExportSelection]=useState<{id:number;owner:string;dayKey:string;since:string|null;intro:string}|null>(null);
  const exportSequence=useRef(0);
  const [savingArena, setSavingArena] = useState(false);
  const [leavingArena, setLeavingArena] = useState(false);
  const [deletingArena, setDeletingArena] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIsPublic, setEditIsPublic] = useState(false);
  const [editSeasonsEnabled, setEditSeasonsEnabled] = useState(true);
  const [leaveConfirm, setLeaveConfirm] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [expandedDayKeys, setExpandedDayKeys] = useState<Set<string>>(new Set());
  const shareOwner=JSON.stringify([user?.id,groupId]);
  const [sharePreviewState,setSharePreviewState]=useState<{title:string;message:string;owner:string}|null>(null);
  const sharePreview=sharePreviewState?.owner===shareOwner?sharePreviewState:null;
  const setSharePreview=useCallback((preview:{title:string;message:string}|null)=>setSharePreviewState(current=>preview?{...preview,owner:shareOwner}:current?.owner===shareOwner?null:current),[shareOwner]);
  const [sharing, setSharing] = useState(false);
  const season=useArenaSeasonContext(user?.id,groupId??'');
  const seasonContext=season.data;
  const reportSince=useMemo(()=>getArenaAnalyticsSince(dateFilter,seasonContext?.currentSeasonStart),[dateFilter,seasonContext?.currentSeasonStart]);
  const seasonSince=seasonContext?new Date(seasonContext.currentSeasonStart+'T00:00:00Z').toISOString():null;
  const report=useArenaAnalytics(season.ready?user?.id:undefined,groupId??'',reportSince,seasonSince,bracketFilter,historyRevision);
  const analyticsPayload=report.ready?report.current:null;
  const allTimeAnalyticsPayload=report.ready?report.awards:null;
  const exportOwner=JSON.stringify([user?.id,groupId]);
  const activeExport=exportSelection?.owner===exportOwner?exportSelection:null;
  const exportDayKey=activeExport?.dayKey??null;
  const exportIntro=activeExport?.intro??'';
  const hasExport=activeExport!==null;
  const exportSince=activeExport?.since??null;
  const exportScope=useMemo(()=>hasExport && groupId?arenaHistoryScope(groupId,{since:exportSince}):null,[hasExport,exportSince,groupId]);
  const dayExport=useArenaDayExport(user?.id,exportScope,exportDayKey);
  const setExportIntro=(intro:string)=>{if(activeExport)setExportSelection(current=>current?.id===activeExport.id?{...current,intro}:current);};

  const [editResetMonth, setEditResetMonth] = useState(1);

  const refreshSeasonContext=season.reload;

  useEffect(() => {
    if (!detailsMatch?.id || detailsMatch.tracking_version == null) {
      setDetailsLiveGame(null);
      setDetailsRecapLoading(false);
      return;
    }
    if (detailsMatch.tracking_version >= 3) {
      setDetailsLiveGame(null);
      setDetailsRecapLoading(false);
      return;
    }
    let active = true;
    setDetailsRecapLoading(true);
    void fetchLiveGameByMatchId(supabase, detailsMatch.id)
      .then((game) => { if (active) setDetailsLiveGame(game); })
      .catch(() => { if (active) setDetailsLiveGame(null); })
      .finally(() => { if (active) setDetailsRecapLoading(false); });
    return () => { active = false; };
  }, [detailsMatch?.id, detailsMatch?.tracking_version]);

  const refreshActiveLiveGame = useCallback(async () => {
    if (!groupId || !user) {
      setActiveLiveGameId(null);
      return;
    }
    try {
      const game = await fetchActiveLiveGame(
        supabase,
        groupId,
        toUserParticipantKey(user.id),
      );
      setActiveLiveGameId(game?.id ?? null);
    } catch {
      setActiveLiveGameId(null);
    }
  }, [groupId, user]);

  useFocusEffect(
    useCallback(() => {
      void refreshActiveLiveGame();
      void refreshSeasonContext();
    }, [refreshActiveLiveGame, refreshSeasonContext]),
  );

  const isMember = isArenaMember(members, user?.id);
  const canManage = canManageArenaMembership({
    userId: user?.id,
    group,
    isPlatformAdmin: false,
  });
  const isArenaManager = Boolean(user && group?.created_by === user.id);
  const matchFormContext = JSON.stringify([user?.id, groupId, isArenaManager]);
  const createFormCommand = useArenaMatchFormCommand(matchFormContext, showRecordModal);
  const editFormCommand = useArenaMatchFormCommand(matchFormContext, editingMatch?.id ?? null);
  const savingMatch = createFormCommand.saving;
  const savingEditMatch = editFormCommand.saving;
  useLayoutEffect(() => { setShowRecordModal(false); setEditingMatch(null); }, [matchFormContext]);

  const canLeave = canLeaveArena(members.length, isMember);

  const periodMatches = useMemo(
    () => filterMatchesByDate(matches, dateFilter, seasonContext?.currentSeasonStart),
    [dateFilter, matches, seasonContext?.currentSeasonStart],
  );
  const filteredMatches = useMemo(
    () => filterMatchesByBracket(periodMatches, bracketFilter),
    [bracketFilter, periodMatches],
  );

  const analyticsView = useMemo(
    () => analyticsPayload
      ? buildArenaAnalyticsView(analyticsPayload, bracketFilter, deckStatsSort)
      : null,
    [analyticsPayload, bracketFilter, deckStatsSort],
  );

  const emptyAnalytics=createEmptyArenaAnalyticsView();
  const playerStats=analyticsView?.players??emptyAnalytics.players;
  const commanderStats=analyticsView?.commanders??emptyAnalytics.commanders;
  const bracketOptions=analyticsPayload?.bracketOptions??[];
  const colorAnalytics=analyticsView?.colors??emptyAnalytics.colors;
  const arenaAwards=useMemo(()=>allTimeAnalyticsPayload?buildArenaAnalyticsView(allTimeAnalyticsPayload).awards:[],[allTimeAnalyticsPayload]);
  const playerAwards=useMemo(()=>buildPlayerAwardsFromAggregates(allTimeAnalyticsPayload?.players??[]),[allTimeAnalyticsPayload]);
  const reportedMatchCount=analyticsView?.totalMatches??0;

  const matchDayGroups = useMemo(() => {
    const locale = language === 'it' ? 'it-IT' : 'en-US';
    return groupMatchesByDay(filteredMatches, {
      unknownDateLabel:language==='it'?'Data non disponibile':'Date unavailable',
      formatLabel: (dayKey) => {
        const [year, month, day] = dayKey.split('-').map(Number);
        return new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }).format(new Date(year, month - 1, day));
      },
    });
  }, [filteredMatches, language]);

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

  const toggleDayGroup = useCallback((dayKey: string, open: boolean) => {
    setExpandedDayKeys((current) => {
      const next = new Set(current);
      if (open) {
        next.add(dayKey);
      } else {
        next.delete(dayKey);
      }
      return next;
    });
  }, []);

  const closeExportModal = useCallback(() => {setExportSelection(null);}, []);
  const openDayExportModal = useCallback((dayKey: string) => {
    setExportSelection({id:++exportSequence.current,owner:exportOwner,dayKey,
      since:getArenaAnalyticsSince(dateFilter,seasonContext?.currentSeasonStart),intro:''});
  }, [dateFilter,exportOwner,seasonContext?.currentSeasonStart]);

  const exportDayGroup = useMemo(
    () => matchDayGroups.find((entry) => entry.dayKey === exportDayKey) ?? null,
    [exportDayKey, matchDayGroups],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refresh(), refreshActiveLiveGame(), refreshSeasonContext()]);
    setRefreshing(false);
  }, [refresh, refreshActiveLiveGame, refreshSeasonContext]);

  const shareInvite = useCallback(() => {
    if (!group) return;
    setShowInviteQr(true);
  }, [group]);

  const shareArenaStats = () => {void recap.controller.open();};

  const confirmSharePreview = useCallback(async () => {
    if (!sharePreview) return;
    setSharing(true);
    try {
      await Share.share({
        title: sharePreview.title,
        message: sharePreview.message,
      });
      setSharePreviewState(current=>current===sharePreview?null:current);
      showToast(copy('statsShared'));
    } catch {
      showAppAlert(copy('error'), copy('shareStatsFailed'));
    } finally {
      setSharing(false);
    }
  }, [copy, sharePreview, showToast]);

  const buildSessionExportMatch = (match: ArenaMatch): ArenaSessionExportMatch => ({
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

  const handleExportDayMatches = useCallback(async () => {
    if (!group || !activeExport || !dayExport.ready || !dayExport.matches.length) return;

    const exportMatches = [...dayExport.matches as unknown as ArenaMatch[]]
      .reverse()
      .map((match) => buildSessionExportMatch(match));
    const text = buildArenaSessionExportText(exportIntro, exportMatches);
    if (!text.trim()) return;

    try {
      await Share.share({
        title: exportDayGroup?.label ?? activeExport.dayKey,
        message: text,
      });
      setExportSelection(current=>current?.id===activeExport.id?null:current);
      showToast(copy('exportCopied'));
    } catch {
      showAppAlert(copy('error'), copy('shareStatsFailed'));
    }
  }, [activeExport,dayExport.matches,dayExport.ready,copy, exportDayGroup, exportIntro, group, showToast]);

  const handleShareMatch = useCallback(
    (match: ArenaMatch) => {
      if (!group) return;
      const locale = language === 'it' ? 'it-IT' : 'en-US';
      const message = buildMatchShareText(match, group.name, {
        matchTitle: copy('matchShareTitle'),
        playersAndDecks: copy('playersAndDecks'),
        noDeckSelected: copy('noDeckSelected'),
        winner: copy('winner'),
        draw: copy('liveGameDraw'),
        comment: copy('comment'),
        noComment: copy('noComment'),
        duration: copy('matchDuration'),
        damageDealt: copy('damageDealt'),
        eliminations: copy('eliminations'),
      }, locale);
      setSharePreview({ title: copy('shareMatchLog'), message });
    },
    [copy, group, language,setSharePreview],
  );

  const openEditModal = () => {
    if (!group) return;
    setEditName(group.name);
    setEditDescription(group.description || '');
    setEditIsPublic(Boolean(group.is_public));
    setEditSeasonsEnabled(group.seasons_enabled ?? true);
    setEditResetMonth(group.season_reset_month ?? seasonContext?.resetMonth ?? 1);
    setShowEditModal(true);
  };

  const handleUpdateArena = async () => {
    if (!editName.trim()) return;
    setSavingArena(true);
    try {
      await updateGroup(editName, editDescription, editIsPublic);
      const seasonSettingsChanged = editSeasonsEnabled !== (group?.seasons_enabled ?? true)
        || editResetMonth !== (seasonContext?.resetMonth ?? group?.season_reset_month ?? 1);
      if (seasonSettingsChanged) {
        await setArenaSeasonSettings(supabase, groupId, editSeasonsEnabled, editResetMonth);
        await refreshSeasonContext();
        await refresh();
      }
      setShowEditModal(false);
      showToast(copy('arenaUpdated'));
    } catch (error) {
      showAppAlert(copy('error'), getSupabaseErrorMessage(error, copy('updateArenaFailed')));
    } finally {
      setSavingArena(false);
    }
  };

  const handleLeaveArena = async () => {
    if (!isLeaveArenaConfirmationValid(leaveConfirm)) {
      showAppAlert(copy('error'), copy('leaveArenaHint'));
      return;
    }

    setLeavingArena(true);
    try {
      await leaveArena();
      setShowLeaveModal(false);
      router.replace('/(tabs)');
    } catch (error) {
      showAppAlert(copy('error'), getSupabaseErrorMessage(error, copy('leaveArenaFailed')));
    } finally {
      setLeavingArena(false);
    }
  };

  const handleDeleteArena = async () => {
    if (!group || deleteConfirm !== group.name) return;

    setDeletingArena(true);
    try {
      await deleteArena();
      setShowDeleteModal(false);
      showAppAlert(copy('arenaDeleted'));
      router.replace('/(tabs)');
    } catch (error) {
      showAppAlert(copy('error'), getSupabaseErrorMessage(error, copy('deleteArenaFailed')));
    } finally {
      setDeletingArena(false);
    }
  };

  const handleKickMember = (memberId: string, displayName: string) => {
    showAppAlert(copy('removeMember'), copy('removeMemberConfirm'), [
      { text: copy('cancel'), style: 'cancel' },
      {
        text: copy('removeMember'),
        style: 'destructive',
        onPress: async () => {
          try {
            await kickMember(memberId);
            showAppAlert(copy('memberRemoved'), displayName);
          } catch (error) {
            showAppAlert(copy('error'), getSupabaseErrorMessage(error, copy('removeMemberFailed')));
          }
        },
      },
    ]);
  };

  const showGuestAlert = (title: string, message?: string, buttons?: AppAlertButton[]) => {
    Keyboard.dismiss();
    setGuestAlert({ title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] });
  };

  const handleDeleteGuest = (guestId: string) => {
    showGuestAlert(copy('deleteGuest'), copy('deleteGuestConfirm'), [
      { text: copy('cancel'), style: 'cancel' },
      {
        text: copy('deleteGuest'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeGuest(guestId);
            showGuestAlert(copy('guestDeleted'));
          } catch (error) {
            showGuestAlert(copy('error'), getSupabaseErrorMessage(error, copy('saveGuestFailed')));
          }
        },
      },
    ]);
  };

  const handleCreateGuestClaimLink = async (guestId: string) => {
    try {
      const guest = guests.find((entry) => entry.id === guestId);
      const { data, error, status } = await apiPost<{ url: string }>('/api/guest-claims', { guestId });
      if (status !== 200 || !data?.url) {
        showGuestAlert(copy('error'), error || copy('createGuestLinkFailed'));
        return;
      }
      await Share.share({ title: guest?.display_name || copy('guestBadge'), message: `${copy('joinInviteHint')}\n${data.url}`, url: data.url });
    } catch (error) {
      showGuestAlert(copy('error'), getSupabaseErrorMessage(error, copy('createGuestLinkFailed')));
    }
  };

  const handleDeleteMatch = (matchId: string) => {
    showAppAlert(copy('deleteMatch'), copy('deleteMatchConfirm'), [
      { text: copy('cancel'), style: 'cancel' },
      {
        text: copy('deleteMatch'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMatch(matchId);
            showToast(copy('matchDeleted'));
          } catch (error) {
            showAppAlert(copy('error'), getSupabaseErrorMessage(error, copy('saveMatchFailed')));
          }
        },
      },
    ]);
  };

  if (loading && !group) {
    return <ArenaSkeleton contentStyle={scrollContentStyle} />;
  }

  if (!group) {
    return (
      <Screen safeBottom>
        <PhyrexianPanel style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{arenaError ? (language==='it'?'Playgroup non disponibile':'Playgroup unavailable'):copy('arenaNotFound')}</Text>
          {arenaError?<Button label={language==='it'?'Riprova':'Retry'} onPress={()=>void refresh()}/>:null}
          <Button label={copy('goToDashboard')} onPress={() => router.replace('/(tabs)')} />
        </PhyrexianPanel>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} safeBottom padded={false}>
      <ScrollView
        contentContainerStyle={scrollContentStyle}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        <Pressable style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={colors.primaryMuted} />
          <Text style={styles.backLabel}>{copy('back')}</Text>
        </Pressable>

        {arenaError?<View style={{gap:10}}><Text accessibilityRole="alert" style={{color:colors.destructive}}>{language==='it'?'Dati del playgroup non aggiornati. Riprova.':'Playgroup data is not current. Retry.'}</Text><Button label={language==='it'?'Riprova':'Retry'} onPress={()=>void refresh()}/></View>:null}
        {activeLiveGameId ? (
          <PhyrexianPanel style={styles.resumePanel}>
            <Text style={styles.resumeTitle}>{copy('gameInProgress')}</Text>
            <Text style={styles.resumeHint}>{copy('resumeGameHint')}</Text>
            <Button
              label={copy('resumeGame')}
              icon="play"
              onPress={() => router.push(`/table/${groupId}/play`)}
            />
          </PhyrexianPanel>
        ) : null}

        <ArenaCommandPanel
          name={group.name}
          description={group.description}
          inviteCode={group.invite_code}
          season={seasonContext ? {
            title: formatArenaSeasonLabel(seasonContext.currentSeasonStart, seasonContext.currentSeasonEnd, language === 'it' ? 'it-IT' : 'en-US'),
            dates: `${formatArenaSeasonDate(seasonContext.currentSeasonStart, language === 'it' ? 'it-IT' : 'en-US')} – ${formatArenaSeasonDate(seasonContext.currentSeasonEnd, language === 'it' ? 'it-IT' : 'en-US')}`,
            label: language === 'it' ? 'Season corrente' : 'Current season',
          } : undefined}
          labels={{
            invite: copy('invite'),
            playGame: copy('playGame'),
            recordBattle: copy('recordBattle'),
          }}
          onPlayGame={() => router.push(`/table/${groupId}/play`)}
          onRecordBattle={() => setShowRecordModal(true)}
        />
        <ArenaTabBar
          activeTab={activeTab}
          labels={{
            matches: copy('matchesTab'),
            players: copy('playersTab'),
            decks: copy('decksTab'),
            awards: copy('awardsTab'),
            meta: copy('metaTab'),
          }}
          onChange={setActiveTab}
        />

        <ArenaFilterPanel
          activeTab={activeTab}
          dateFilter={dateFilter}
          bracketFilter={bracketFilter}
          deckStatsSort={deckStatsSort}
          bracketOptions={bracketOptions}
          dateFilters={DATE_FILTERS}
          dateFilterLabels={{
            all: copy(seasonContext ? DATE_FILTER_KEYS.all : 'filterAllTime'),
            '7d': copy(DATE_FILTER_KEYS['7d']),
            '30d': copy(DATE_FILTER_KEYS['30d']),
            '90d': copy(DATE_FILTER_KEYS['90d']),
          }}
          deckSortLabels={{
            winRate: copy(DECK_SORT_KEYS.winRate),
            gamesPlayed: copy(DECK_SORT_KEYS.gamesPlayed),
          }}
          labels={{
            filterPeriod: copy('filterPeriod'),
            bracket: copy('bracket'),
            allBrackets: copy('allBrackets'),
            sortBy: copy('sortBy'),
          }}
          onDateFilterChange={setDateFilter}
          onBracketFilterChange={setBracketFilter}
          onDeckStatsSortChange={setDeckStatsSort}
        />

        {activeTab === 'matches' ? (
          <View style={styles.matchesContent}>
            <ArenaHistoryStatus loaded={matches.length} total={historyTotal} loading={historyLoading} error={historyError}
              cached={historyCached} language={language} onRetry={retryHistory}/>
            {(!historyLoading && !historyError || matches.length>0) ? <TableMatchesList
              dayGroups={matchDayGroups}
              expandedDayKeys={expandedDayKeys}
              emptyTitle={hasMoreMatches || historyCached ? (language==='it'?'Nessuna partita tra quelle caricate':'No matches among loaded pages'):copy('noMatchesTitle')}
              emptyBody={copy('noMatchesBody')}
              recordBattleLabel={copy('recordBattle')}
              matchCountLabel={(count) => copy(count === 1 ? 'matchSingular' : 'matchPlural')}
              onToggleDay={toggleDayGroup}
              onEditMatch={setEditingMatch}
              onShareMatch={handleShareMatch}
              onDeleteMatch={handleDeleteMatch}
              onDetailsMatch={setDetailsMatch}
              onRecordBattle={() => setShowRecordModal(true)}
              exportDayLabel={copy('exportDay')}
              drawLabel={copy('liveGameDraw')}
              onExportDay={openDayExportModal}
              hasMore={hasMoreMatches && !historyError}
              loadingMore={loadingMoreMatches}
              loadMoreLabel={copy('loadOlderMatches')}
              loadingMoreLabel={copy('loadingOlderMatches')}
              onLoadMore={loadMoreMatches}
            /> : null}
            {seasonContext ? <PreviousSeasonsPanel archives={seasonContext.archives} /> : null}
          </View>
        ) : null}

        {activeTab === 'players' ? (
          <ArenaAnalyticsStatus loading={season.loading || report.loading} error={season.error || report.error} language={language} onRetry={season.error?season.reload:report.reload}>
          <TablePlayersTab
            filteredMatchCount={reportedMatchCount}
            members={members}
            playerStats={playerStats}
            labels={{
              totalGames: copy('totalGames'),
              players: copy('players'),
              users: copy('users'),
              leaderboard: copy('leaderboard'),
              playerLeaderboard: copy('playerLeaderboard'),
              playerLeaderboardHint: copy('playerLeaderboardHint'),
              statisticsMethodHint: copy('statisticsMethodHint'),
              noMatchesBody: copy('noMatchesBody'),
              games: copy('games'),
              wins: copy('wins'),
              winRate: copy('winRate'),
              guestBadge: copy('guestBadge'),
              creator: copy('creator'),
              you: copy('you'),
              directInviteTitle: copy('directInviteTitle'),
              directInviteHint: copy('directInviteHint'),
              searchUser: copy('searchUser'),
              invitationSent: copy('invitationSent'),
              invitationFailed: copy('invitationFailed'),
            }}
            canKickMember={(memberId) => canKickArenaMember({
              actorId: user?.id || '',
              targetId: memberId,
              group,
              isPlatformAdmin: false,
            })}
            onKickMember={handleKickMember}
            onMessage={(message, error) => error ? showAppAlert(copy('error'), message) : showToast(message)}
          />
          </ArenaAnalyticsStatus>
        ) : null}

        {activeTab === 'decks' ? (
          <ArenaAnalyticsStatus loading={season.loading || report.loading} error={season.error || report.error} language={language} onRetry={season.error?season.reload:report.reload}>
          <TableDecksTab
            commanderStats={commanderStats}
            labels={{
              noDeckStatsTitle: copy('noDeckStatsTitle'),
              noDeckStatsBody: copy('noDeckStatsBody'),
              bestDeck: copy('bestDeck'),
              uniqueDecks: copy('uniqueDecks'),
              winRate: copy('winRate'),
              trackedDecks: copy('trackedDecks'),
              deckRankings: copy('deckRankings'),
              bracket: copy('bracket'),
              games: copy('games'),
              showProvisionalDecks: copy('showProvisionalDecks'),
              hideProvisionalDecks: copy('hideProvisionalDecks'),
              provisionalDeckSample: copy('provisionalDeckSample'),
              statisticsMethodHint: copy('statisticsMethodHint'),
              statisticsSampleHint: copy('statisticsSampleHint'),
              noRankedDecks: copy('noRankedDecks'),
            }}
          />
          </ArenaAnalyticsStatus>
        ) : null}

        {activeTab === 'awards' ? (
          <ArenaAnalyticsStatus loading={season.loading || report.loading} error={season.error || report.error} language={language} onRetry={season.error?season.reload:report.reload}>
          <View style={styles.awardsSection}>
          <View style={styles.awardsToggle}>
            {(['decks', 'players'] as const).map((view) => <Pressable key={view} onPress={() => setAwardsView(view)} style={[styles.awardsToggleButton, awardsView === view && styles.awardsToggleButtonActive]}><Text style={[styles.awardsToggleText, awardsView === view && styles.awardsToggleTextActive]}>{view === 'players' ? (language === 'it' ? 'Giocatori' : 'Players') : (language === 'it' ? 'Mazzi' : 'Decks')}</Text></Pressable>)}
          </View>
          {awardsView === 'decks' ? <TableAwardsTab
            awards={arenaAwards}
            labels={{
              emptyTitle: copy('awardsEmptyTitle'),
              emptyBody: copy('awardsEmptyBody'),
              hint: copy('awardsHint'),
              fastest: copy('awardFastest'),
              slugger: 'Group Slugger',
              executioner: 'Executioner',
              runnerUp: copy('awardRunnerUp'),
              archenemy: copy('awardArchenemy'),
              comebacker: copy('awardComebacker'),
              oneTrick: copy('awardOneTrick'),
              comboWinner: copy('awardComboWinner'),
              junkMaster: copy('awardJunkMaster'),
              descriptions: {
                fastest: copy('awardFastestHint'), group_slugger: copy('awardSluggerHint'), executioner: copy('awardExecutionerHint'),
                runner_up: copy('awardRunnerUpHint'), archenemy: copy('awardArchenemyHint'), comebacker: copy('awardComebackerHint'),
                one_trick: copy('awardOneTrickHint'), combo_winner: copy('awardComboWinnerHint'), junk_master: copy('awardJunkMasterHint'),
              },
              trackedGames: copy('trackedGames'),
              games: copy('games'),
              wins: copy('wins'),
            }}
          /> : <PlayerAwardsTab awards={playerAwards} language={language} />}
          </View>
          </ArenaAnalyticsStatus>
        ) : null}

        {activeTab === 'meta' ? (
          <ArenaAnalyticsStatus loading={season.loading || report.loading} error={season.error || report.error} language={language} onRetry={season.error?season.reload:report.reload}>
          <TableMetaTab
            filteredMatchCount={reportedMatchCount}
            colorAnalytics={colorAnalytics}
            language={language}
            labels={{
              noMetaDataTitle: copy('noMetaDataTitle'),
              noMetaDataBody: copy('noMetaDataBody'),
              missingColorGames: copy('missingColorGames'),
              colorMeta: copy('colorMeta'),
              colorMetaHint: copy('colorMetaHint'),
              multicolorIdentities: copy('multicolorIdentities'),
              multicolorIdentitiesHint: copy('multicolorIdentitiesHint'),
              colorLabel: copy('colorLabel'),
              sortBy: copy('sortBy'),
              appearances: copy('appearances'),
              wins: copy('wins'),
              winRate: copy('winRate'),
              noGamesInPeriod: copy('noGamesInPeriod'),
              minThreeGames: copy('minThreeGames'),
              noColorsResolved: copy('noColorsResolved'),
              noMulticolorIdentities: copy('noMulticolorIdentities'),
              multicolorPairsHint: copy('multicolorPairsHint'),
              pentacolor: copy('pentacolor'),
            }}
          />
          </ArenaAnalyticsStatus>
        ) : null}

        {false && (canManage || guests.length > 0) ? (
          <TableGuestsSection
              key={`${user?.id}:${groupId}`}
              language={language}
            guests={guests}
            canManage={canManage}
            labels={{
              guestManagement: copy('guestManagement'),
              addGuest: copy('addGuest'),
              noGuestsBody: copy('noGuestsBody'),
              guestBadge: copy('guestBadge'),
              upgradeGuest: copy('upgradeGuest'),
              addDeckToGuest: copy('addDeckToGuest'),
              deleteGuest: copy('deleteGuest'),
            }}
            onAddGuest={() => {
              setGuestModalMode(undefined);
              setGuestModalTargetId(null);
              setShowGuestModal(true);
            }}
            onAddDeckToGuest={(guestId) => {
              setGuestModalMode('add-deck-to-guest');
              setGuestModalTargetId(guestId);
              setShowGuestModal(true);
            }}
            onDeleteGuest={handleDeleteGuest}
            onUpgradeGuest={(guestId) => void handleCreateGuestClaimLink(guestId)}
          />
        ) : null}

        {isMember ? (
          <TableArenaManagement
              showExportStats={Boolean(user?.id && groupId)}
            canManage={canManage}
            canLeave={canLeave}
            labels={{
              arenaManagement: copy('arenaManagement'),
              shareInvite: copy('shareInvite'),
              exportArenaStats: recap.labels.open,
              editArena: copy('editArena'),
              guests: copy('guests'),
              leaveArena: copy('leaveArena'),
              deleteArena: copy('deleteArena'),
            }}
            onShareInvite={shareInvite}
            onExportStats={shareArenaStats}
            onEdit={openEditModal}
            onGuests={() => setShowGuestsManager(true)}
            onLeave={() => {
              setLeaveConfirm('');
              setShowLeaveModal(true);
            }}
            onDelete={() => {
              setDeleteConfirm('');
              setShowDeleteModal(true);
            }}
          />
        ) : null}
      </ScrollView>

      <ArenaRecapDialog recap={recap} />
      <SharePreviewModal
        visible={Boolean(sharePreview)}
        title={sharePreview?.title || ''}
        preview={sharePreview?.message || ''}
        previewLabel={copy('sharePreview')}
        shareLabel={copy('shareNow')}
        cancelLabel={copy('cancel')}
        onClose={() => setSharePreview(null)}
        onShare={confirmSharePreview}
        sharing={sharing}
      />

      <GuestDialogHost
        managerOpen={showGuestsManager}
        editorOpen={showGuestModal}
        onClose={() => {
          if (guestAlert) setGuestAlert(null);
          else if (showGuestModal) {
            setShowGuestModal(false);
            setGuestModalMode(undefined);
            setGuestModalTargetId(null);
          } else setShowGuestsManager(false);
        }}
        alert={guestAlert ? (
          <ConfirmModal embedded visible title={guestAlert.title} message={guestAlert.message}
            onClose={() => setGuestAlert(null)}
            actions={guestAlert.buttons.map((button) => ({
              label: button.text || 'OK',
              variant: button.style === 'destructive' ? 'destructive' : button.style === 'cancel' ? 'ghost' : 'primary',
              onPress: () => { setGuestAlert(null); void button.onPress?.(); },
            }))}
          />
        ) : null}
        manager={<>
            <Text style={styles.modalTitle}>{copy('guestManagement')}</Text>
            <TableGuestsSection
              key={`${user?.id}:${groupId}`}
              language={language}
              guests={guests}
              canManage={canManage}
              labels={{ guestManagement: copy('guestManagement'), addGuest: copy('addGuest'), noGuestsBody: copy('noGuestsBody'), guestBadge: copy('guestBadge'), upgradeGuest: copy('upgradeGuest'), addDeckToGuest: copy('addDeckToGuest'), deleteGuest: copy('deleteGuest') }}
              onAddGuest={() => { setGuestModalMode(undefined); setGuestModalTargetId(null); setShowGuestModal(true); }}
              onAddDeckToGuest={(guestId) => { setGuestModalMode('add-deck-to-guest'); setGuestModalTargetId(guestId); setShowGuestModal(true); }}
              onDeleteGuest={handleDeleteGuest}
              onUpgradeGuest={(guestId) => void handleCreateGuestClaimLink(guestId)}
            />
        </>}
        editor={(
          <AddGuestModal
            embedded
            visible={showGuestModal}
            saving={savingGuest}
            guests={guests}
            initialMode={guestModalMode}
            initialGuestId={guestModalTargetId}
            labels={{
              title: copy('addGuestTitle'),
              addDeckTitle: copy('addGuestDeckTitle'),
              hint: copy('addGuestHint'),
              addDeckHint: copy('addGuestDeckHint'),
              pickExistingHint: copy('pickExistingGuestHint'),
              existingGuests: copy('existingGuests'),
              createNewGuest: copy('createNewGuest'),
              backToExistingGuests: copy('backToExistingGuests'),
              guestName: copy('guestName'),
              guestNamePlaceholder: copy('guestNamePlaceholder'),
              deckName: copy('deckName'),
              deckNamePlaceholder: copy('deckNamePlaceholder'),
              searchCommander: copy('searchCommander'),
              searchPlaceholder: copy('searchPlaceholder'),
              searching: copy('searching'),
              noResults: copy('noCommanderResults'),
              selectedCommander: copy('selectedCommander'),
              partnerHint: copy('partnerHint'),
              chooseCommanderArt: copy('chooseCommanderArt'),
              loadingArts: copy('loadingArts'),
              noArtsFound: copy('noArtsFound'),
              printing: copy('printing'),
              cancel: copy('cancel'),
              save: copy('save'),
              saveDeck: copy('saveGuestDeck'),
              saving: copy('saving'),
              nameRequired: copy('nameRequired'),
              commanderRequired: copy('commanderRequired'),
              decks: copy('decks'),
              addDeckToGuest: copy('addDeckToGuest'),
            }}
            onClose={() => {
              setShowGuestModal(false);
              setGuestModalMode(undefined);
              setGuestModalTargetId(null);
            }}
            onError={(message) => showGuestAlert(copy('error'), message)}
            onPickExisting={() => setShowGuestModal(false)}
            onSaveCreate={async (input) => {
              setSavingGuest(true);
              try {
                await addGuest({
                  displayName: input.displayName,
                  commander: input.commander,
                  partnerCommander: input.partnerCommander,
                  deckName: input.deckName,
                  selectedArtUrl: input.selectedArtUrl,
                });
                setShowGuestModal(false);
                setGuestModalMode(undefined);
                setGuestModalTargetId(null);
                showToast(copy('guestAddedHint'));
              } catch (error) {
                showGuestAlert(copy('error'), getSupabaseErrorMessage(error, copy('saveGuestFailed')));
              } finally {
                setSavingGuest(false);
              }
            }}
            onSaveAddDeck={async (input) => {
              setSavingGuest(true);
              try {
                await addGuestDeck({
                  guestId: input.guestId,
                  commander: input.commander,
                  partnerCommander: input.partnerCommander,
                  deckName: input.deckName,
                  selectedArtUrl: input.selectedArtUrl,
                });
                setShowGuestModal(false);
                setGuestModalMode(undefined);
                setGuestModalTargetId(null);
                showToast(copy('guestDeckAddedHint'));
              } catch (error) {
                showGuestAlert(copy('error'), getSupabaseErrorMessage(error, copy('saveGuestFailed')));
              } finally {
                setSavingGuest(false);
              }
            }}
          />
        )}
      />

      <RecordMatchModal
        groupId={groupId}
        visible={showRecordModal}
        saving={savingMatch}
        members={members}
        guests={guests}
        decks={decks}
        matches={matches}
        labels={{
          title: copy('recordMatchTitle'),
          hint: copy('recordMatchHint'),
          selectPlayers: copy('selectPlayers'),
          selectGuests: copy('selectGuests'),
          selectWinner: copy('selectWinner'),
          winCondition: copy('liveGameWinCondition'),
          winLastStanding: copy('liveGameWinLastStanding'),
          winCombo: copy('liveGameWinCombo'),
          winConcession: copy('liveGameWinConcession'),
          winAlternate: copy('liveGameWinAlternateCard'),
          winOther: copy('liveGameWinOther'),
          draw: copy('liveGameDraw'),
          battleDate: copy('battleDate'),
          notes: copy('notes'),
          notesPlaceholder: copy('notesPlaceholder'),
          richTextHint: copy('richTextHint'),
          selectDeck: copy('selectDeck'),
          cancel: copy('cancel'),
          save: copy('save'),
          saving: copy('saving'),
          minPlayersError: copy('minPlayersError'),
          winnerError: copy('winnerError'),
          deckError: copy('deckError'),
          dateError: copy('dateError'),
          guestBadge: copy('guestBadge'),
          deckCount: (count) =>
            `(${count} ${copy(count === 1 ? 'deckSingular' : 'deckPlural')})`,
          searchPlaceholder: copy('searchDecksPlaceholder'),
          showDeckList: copy('showDeckList'),
          hideDeckList: copy('hideDeckList'),
          selectDeckPrompt: copy('selectDeckPrompt'),
          deckListHiddenSelected: copy('deckListHiddenSelected'),
          deckListHiddenEmpty: copy('deckListHiddenEmpty'),
          noDecksMatchSearch: copy('noDecksMatchSearch'),
          swipeDecksHint: copy('swipeDecksHint'),
        }}
        onClose={() => setShowRecordModal(false)}
        onError={(message) => showAppAlert(copy('error'), message)}
        onSave={async (input) => {
          await createFormCommand.run(signal => createMatch({ ...input, signal, requestScope: createFormCommand.opening }),
            () => { setShowRecordModal(false); void hapticSuccess(); showToast(copy('battleRecordedHint')); },
            error => showAppAlert(copy('error'), getArenaMatchWriteFailureMessage(error, language === 'it' ? 'it' : 'en')));
        }}
      />

      <MatchDetailsModal
        visible={Boolean(detailsMatch)}
        match={detailsMatch}
        liveGame={detailsLiveGame}
        recapLoading={detailsRecapLoading}
        onClose={() => { setDetailsMatch(null); setDetailsLiveGame(null); }}
        labels={{
          title: copy('matchDetailsTitle'),
          duration: copy('matchDuration'),
          damageDealt: copy('damageDealt'),
          lifeLost: copy('lifeLost'),
          lifeGained: copy('lifeGained'),
          commander: copy('liveGameCommanderDamage'),
          infect: copy('liveGameInfect'),
          started: copy('startedPlayer'),
          timeline: copy('liveGameLifeTimeline'),
          highlights: copy('liveGameHighlights'),
          empty: copy('liveGameLogEmpty'),
          recap: copy('liveGameRecap'),
          tablePressure: language === 'it' ? 'Pressione sul tavolo' : 'Table pressure',
        }}
      />

      <ArenaInviteQrModal
        visible={showInviteQr}
        inviteCode={group.invite_code}
        arenaName={group.name}
        onClose={() => setShowInviteQr(false)}
        labels={{
          title: copy('shareInvite'),
          hint: copy('inviteQrHint'),
          close: copy('close'),
          link: 'Link',
          qr: copy('inviteQr'),
          share: copy('shareNow'),
        }}
      />

      <EditMatchModal
        groupId={groupId}
        visible={Boolean(editingMatch)}
        saving={savingEditMatch}
        canManage={isArenaManager}
        match={editingMatch}
        members={members}
        guests={guests}
        decks={decks}
        labels={{
          title: copy('editMatchTitle'),
          hint: copy('editMatchHint'),
          selectWinner: copy('selectWinner'),
          draw: copy('liveGameDraw'),
          battleDate: copy('battleDate'),
          notes: copy('notes'),
          notesPlaceholder: copy('notesPlaceholder'),
          richTextHint: copy('richTextHint'),
          selectDeck: copy('selectDeck'),
          cancel: copy('cancel'),
          save: copy('save'),
          saving: copy('saving'),
          winnerError: copy('winnerError'),
          dateError: copy('dateError'),
          guestBadge: copy('guestBadge'),
          deckCount: (count) =>
            `(${count} ${copy(count === 1 ? 'deckSingular' : 'deckPlural')})`,
          searchPlaceholder: copy('searchDecksPlaceholder'),
          showDeckList: copy('showDeckList'),
          hideDeckList: copy('hideDeckList'),
          selectDeckPrompt: copy('selectDeckPrompt'),
          deckListHiddenSelected: copy('deckListHiddenSelected'),
          deckListHiddenEmpty: copy('deckListHiddenEmpty'),
          noDecksMatchSearch: copy('noDecksMatchSearch'),
          swipeDecksHint: copy('swipeDecksHint'),
          winCondition: copy('liveGameWinCondition'),
          winConditions: {
            last_standing: copy('liveGameWinLastStanding'),
            combo: copy('liveGameWinCombo'),
            concession: copy('liveGameWinConcession'),
            alternate_card: copy('liveGameWinAlternateCard'),
            other: copy('liveGameWinOther'),
          },
          replacePlayer: copy('replacePlayer'),
          selectPlayer: copy('selectPlayer'),
        }}
        onClose={() => setEditingMatch(null)}
        onError={(message) => showAppAlert(copy('error'), message)}
        onSave={async (input) => {
          await editFormCommand.run(signal => updateMatch({ ...input, isArenaManager, signal }),
            () => { setEditingMatch(null); void hapticSuccess(); showToast(copy('matchUpdated')); },
            error => showAppAlert(copy('error'), getArenaMatchWriteFailureMessage(error, language === 'it' ? 'it' : 'en')));
        }}
      />

      <Modal visible={showEditModal} onClose={() => setShowEditModal(false)}>
        <Text style={styles.modalTitle}>{copy('editArenaTitle')}</Text>
        <Input label={copy('arenaName')} value={editName} onChangeText={setEditName} />
        <Input
          label={copy('arenaDescription')}
          value={editDescription}
          onChangeText={setEditDescription}
          placeholder={copy('arenaDescriptionPlaceholder')}
        />
        <View style={styles.publicRow}>
          <View style={styles.publicText}>
            <Text style={styles.publicTitle}>{copy('publicArenaProfile')}</Text>
            <Text style={styles.publicHint}>{copy('publicArenaProfileHint')}</Text>
          </View>
          <Switch
            value={editIsPublic}
            onValueChange={setEditIsPublic}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.foreground}
          />
        </View>
        <ArenaSeasonSettings
          enabled={editSeasonsEnabled}
          resetMonth={editResetMonth}
          locale={language === 'it' ? 'it-IT' : 'en-US'}
          labels={{
            enabled: copy('seasonsEnabled'),
            enabledHint: copy('seasonsEnabledHint'),
            startMonth: copy('seasonStartMonth'),
            resetHint: copy('seasonResetHint'),
          }}
          onEnabledChange={setEditSeasonsEnabled}
          onResetMonthChange={setEditResetMonth}
        />
        {canManage ? (
          <TableUserManagement
            members={members}
            groupId={group.id}
            creatorId={group.created_by}
            userId={user?.id}
            canKick={(memberId) => canKickArenaMember({ actorId: user?.id || '', targetId: memberId, group, isPlatformAdmin: false })}
            onKick={handleKickMember}
            labels={{ title: copy('users'), creator: copy('creator'), you: copy('you'), inviteTitle: copy('directInviteTitle'), inviteHint: copy('directInviteHint'), search: copy('searchUser'), sent: copy('invitationSent'), failed: copy('invitationFailed') }}
            onMessage={(message, error) => error ? showAppAlert(copy('error'), message) : showToast(message)}
          />
        ) : null}
        <View style={styles.modalActions}>
          <Button label={copy('cancel')} variant="ghost" onPress={() => setShowEditModal(false)} style={styles.modalButton} />
          <Button
            label={savingArena ? copy('saving') : copy('saveChanges')}
            disabled={savingArena || !editName.trim()}
            onPress={handleUpdateArena}
            style={styles.modalButton}
          />
        </View>
      </Modal>



      <Modal visible={showLeaveModal} onClose={() => setShowLeaveModal(false)}>
        <Text style={styles.modalTitle}>{copy('leaveArenaTitle')}</Text>
        <Text style={styles.modalBody}>{copy('leaveArenaHint')}</Text>
        <Input
          label={copy('leaveConfirmPhrase')}
          value={leaveConfirm}
          onChangeText={setLeaveConfirm}
          placeholder={copy('leaveConfirmPlaceholder')}
          autoCapitalize="none"
        />
        <View style={styles.modalActions}>
          <Button label={copy('cancel')} variant="ghost" onPress={() => setShowLeaveModal(false)} style={styles.modalButton} />
          <Button
            label={leavingArena ? copy('saving') : copy('leaveArena')}
            disabled={leavingArena}
            onPress={handleLeaveArena}
            style={styles.modalButton}
          />
        </View>
      </Modal>

      <Modal visible={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
        <Text style={[styles.modalTitle, styles.destructiveTitle]}>{copy('deleteArenaTitle')}</Text>
        <Text style={styles.modalBody}>{copy('deleteArenaHint')}</Text>
        <Text style={styles.confirmName}>{group.name}</Text>
        <Input
          label={copy('deleteArenaConfirmHint')}
          value={deleteConfirm}
          onChangeText={setDeleteConfirm}
          placeholder={group.name}
          autoCapitalize="none"
        />
        <View style={styles.modalActions}>
          <Button label={copy('cancel')} variant="ghost" onPress={() => setShowDeleteModal(false)} style={styles.modalButton} />
          <Button
            label={deletingArena ? copy('saving') : copy('deleteArena')}
            disabled={deletingArena || deleteConfirm !== group.name}
            onPress={handleDeleteArena}
            style={styles.modalButton}
          />
        </View>
      </Modal>

      <Modal visible={Boolean(exportDayKey)} onClose={closeExportModal}>
        <View style={styles.exportModalHeader}>
          <Ionicons name="download-outline" size={22} color={colors.foreground} />
          <Text style={styles.modalTitle}>{copy('exportDayTitle')}</Text>
        </View>
        {exportDayGroup ? (
          <Text style={styles.modalBody}>
            {exportDayGroup.label}
            {' · '}
            {dayExport.ready?dayExport.matches.length:'—'} {copy('matchPlural')}
          </Text>
        ) : null}
        {dayExport.loading?<Text style={styles.modalBody}>{language==='it'?'Caricamento giornata completa…':'Loading complete day…'}</Text>:null}
        {dayExport.error?<View><Text accessibilityRole="alert" style={styles.modalBody}>{language==='it'?'Export non disponibile. Nessun risultato parziale.':'Export unavailable. No partial results.'}</Text><Button label={language==='it'?'Riprova':'Retry'} onPress={dayExport.retry}/></View>:null}
        <RichTextInput
          label={copy('exportIntro')}
          value={exportIntro}
          onChangeText={setExportIntro}
          placeholder={copy('exportIntroPlaceholder')}
          hint={copy('richTextHint')}
        />
        <View style={styles.modalActions}>
          <Button label={copy('cancel')} variant="outline" onPress={closeExportModal} style={styles.modalButton} />
          <Button label={copy('generateExport')} disabled={!dayExport.ready || !dayExport.matches.length} onPress={handleExportDayMatches} style={styles.modalButton} />
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  awardsSection: { gap: spacing.md },
  awardsToggle: { flexDirection: 'row', gap: spacing.sm, padding: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surfaceMuted },
  awardsToggleButton: { flex: 1, alignItems: 'center', borderRadius: 8, paddingVertical: 9 },
  awardsToggleButtonActive: { backgroundColor: colors.primarySurface },
  awardsToggleText: { color: colors.muted, fontWeight: '700' },
  awardsToggleTextActive: { color: colors.primaryLight },
  matchesContent: { gap: spacing.md },
  seasonEditor: {
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: 12,
  },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  monthButton: {
    width: '22%',
    minWidth: 56,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
  },
  monthButtonActive: { borderColor: colors.primaryLight, backgroundColor: colors.selectionTint },
  monthButtonText: { color: colors.muted, fontSize: 12, textTransform: 'capitalize' },
  monthButtonTextActive: { color: colors.primaryMuted, fontWeight: '700' },
  resumePanel: {
    gap: spacing.sm,
    borderColor: colors.selectionBorder,
    backgroundColor: colors.selectionTint,
  },
  resumeTitle: {
    color: colors.primaryMuted,
    fontSize: 15,
    fontWeight: '700',
  },
  resumeHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  exportModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backLabel: {
    color: colors.primaryMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyCard: {
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: 18,
    fontWeight: '600',
  },
  modalTitle: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: '700',
  },
  destructiveTitle: {
    color: colors.destructive,
  },
  modalBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  confirmName: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '700',
  },
  publicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: 12,
  },
  publicText: {
    flex: 1,
    gap: 4,
  },
  publicTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '600',
  },
  publicHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    minWidth: 132,
  },
});
