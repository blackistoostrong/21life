import { useNativeLiveSetup } from '@/hooks/use-native-live-setup';
import { createLiveGameRound } from '@/lib/live-game-round';
import { replayLiveGameOutbox } from '@/lib/live-game-outbox-replay';
import { useLiveGameCommandScope } from '@/hooks/use-live-game-command-scope';
import { SetupRestoreGate } from '@/components/live-game/setup-restore-gate';
import { useFocusEffect , useLocalSearchParams, useRouter } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';

import * as Crypto from 'expo-crypto';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { DeckImage } from '@/components/deck/deck-image';
import { LiveGameConfigurator } from '@/components/live-game/live-game-configurator';
import { TableArena } from '@/components/live-game/table-arena';
import { LiveGameRecapView } from '@/components/live-game/live-game-recap';
import { LiveGameRecoveryPanel } from '@/components/live-game/recovery-panel';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Modal } from '@/components/ui/modal';
import { ModalHeader } from '@/components/ui/modal-header';
import { PhyrexianPanel } from '@/components/ui/phyrexian-panel';
import { Screen } from '@/components/ui/screen';
import { ArenaSkeleton } from '@/components/ui/screen-skeletons';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/language-context';
import { useToast } from '@/contexts/toast-context';
import { useRuntimeConfig } from '@/contexts/runtime-config-context';
import { colors, radii, spacing } from '@/constants/theme';
import { useArena } from '@/hooks/use-arena';
import { useScreenInsets } from '@/hooks/use-screen-insets';
import {
  clearLiveGameRuntimePlayers,
  replaceLiveGameRuntimePlayers,
} from '@/stores/live-game-runtime-store';
import { hapticLight, hapticMedium, hapticSuccess, hapticWarning } from '@/lib/haptics';
import { apiPost } from '@/lib/api';
import { ArenaSyncError, syncAndRefreshArenaMember } from '@/lib/arena-archidekt-sync';
import { queueLiveGameJournalWrite } from '@/lib/live-game-journal-writer';
import { countLiveGamePendingOperations, getLiveGameSyncState, getLiveGameSyncIndicator, getLiveGameSyncCopy, isLiveGameAuthenticationError } from '@/lib/live-game-sync-presentation';
import {
  applyLiveGameMutation,
  getDefaultWinCondition,
  getLiveGameResultWarnings,
  getSuggestedWinner,
  isValidLiveGameResult,
  pickRandomPlayer,
  type DamageMode,
  type LiveGameMutation,
  type LiveGamePlayer,
  type LiveGameRecord,
  type LiveGameState,
  type QueuedLiveGameMutation,
  type WinCondition,
} from '@/lib/live-game';
import { buildRouletteSequence } from '@/lib/live-game-roulette';
import {
  saveLiveGameSetup,
} from '@/lib/live-game-setup';
import { formatGameDuration, getGameDurationSeconds } from '@/lib/live-game-duration';
import { withLiveGameTimeout } from '@/lib/live-game-async';
import { getDiscardConfirmationVisibility } from '@/lib/live-game-modal-state';
import { applyQueuedLiveGameMutations, cancelLiveGame, ensureLiveGameCreated, fetchActiveLiveGame, fetchBusyLiveGameParticipantKeys, subscribeToLiveGame } from '@/lib/live-game-service';
import {
  LIVE_GAME_SYNC_BATCH_SIZE,
  getLiveGameSyncDelay,
} from '@/lib/live-game-sync-policy';
import {
  archiveAndClearLiveGameSession,
  clearLiveGameOfflineSession,
  clearLiveGameOfflineSessionIfMatches,
  loadLiveGameOutbox,
  prepareLiveGameReplacement,
  loadLiveGameOfflineSession,
  saveLiveGameOutbox,
  saveLiveGameOfflineSession,
  type PendingLiveGameFinalization,
  type ArchivedLiveGameOperation,
} from '@/lib/live-game-offline';
import { persistLiveGameTelemetry, recordLiveGameQueueDepth, recordLiveGameSyncError } from '@/lib/live-game-telemetry';
import {
  createLiveGameHistory,
  recordLiveGameHistory,
  redoLiveGameHistory,
  undoLiveGameHistory,
  type LiveGameHistory,
} from '@/lib/live-game-history';
import {
  applyLiveGameImmersive,
  clearLiveGameImmersive,
} from '@/lib/live-game-immersive';
import {
  applyLiveGameOrientationLock,
  clearLiveGameOrientationLock,
} from '@/lib/live-game-orientation';
import { parseParticipantKey, toUserParticipantKey, type ParticipantKey } from '@/lib/participant-keys';
import { getProfileDisplayName } from '@/lib/profile-display';
import { supabase } from '@/lib/supabase';
const WIN_CONDITIONS: {
  value: WinCondition;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: 'liveGameWinLastStanding' | 'liveGameWinCombo' | 'liveGameWinConcession' | 'liveGameWinAlternateCard' | 'liveGameWinOther';
  hintKey: 'liveGameWinLastStandingHint' | 'liveGameWinComboHint' | 'liveGameWinConcessionHint' | 'liveGameWinAlternateCardHint' | 'liveGameWinOtherHint';
}[] = [
  { value: 'last_standing', icon: 'shield-checkmark-outline', labelKey: 'liveGameWinLastStanding', hintKey: 'liveGameWinLastStandingHint' },
  { value: 'combo', icon: 'git-merge-outline', labelKey: 'liveGameWinCombo', hintKey: 'liveGameWinComboHint' },
  { value: 'concession', icon: 'flag-outline', labelKey: 'liveGameWinConcession', hintKey: 'liveGameWinConcessionHint' },
  { value: 'alternate_card', icon: 'sparkles-outline', labelKey: 'liveGameWinAlternateCard', hintKey: 'liveGameWinAlternateCardHint' },
  { value: 'other', icon: 'ellipsis-horizontal-circle-outline', labelKey: 'liveGameWinOther', hintKey: 'liveGameWinOtherHint' },
];

function replayQueuedMutations(
  record: LiveGameRecord,
  queue: QueuedLiveGameMutation[],
): LiveGameRecord {
  return {
    ...record,
    state: queue.reduce(
      (state, entry) => applyLiveGameMutation(state, entry.mutation),
      record.state,
    ),
  };
}

export default function LiveGameScreen() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  const { user, session } = useAuth();
  const currentUserId = user?.id;
  const { epoch: liveScopeEpoch, isCurrent: isLiveScopeCurrent, bindClient: bindLiveClient, beginCommand: beginLiveCommand } =
    useLiveGameCommandScope(currentUserId, groupId, session);
  const { copy, language } = useLanguage();
  const { featureFlags } = useRuntimeConfig();
  const { showToast } = useToast();
  const { scrollContentStyle } = useScreenInsets();

  const { members, guests, decks, matches, loading, group, refreshMemberDecks } = useArena(groupId, user?.id);

  const { selectedKeys, participantDecks, playerCount, setPlayerCount, layoutVariant, setLayoutVariant, seatSetups, setupReadyKey, setupRestoreError, setSetupRetry, startingLife, setOccasionalDecks, getDeckOptions, setupParticipants, applySeatSetups, applyStartingLife, handlePlayerCountChange, handleAssignSeat, resetSetup } = useNativeLiveSetup(groupId, user, { members, guests, decks, matches, loading },
    { epoch: liveScopeEpoch, isCurrent: isLiveScopeCurrent, bindClient: bindLiveClient });

  const [liveGame, setLiveGame] = useState<LiveGameRecord | null>(null);
  const [booting, setBooting] = useState(true);
  const [starting, setStarting] = useState(false);
  const [archidektSyncRequest, setArchidektSyncRequest] = useState<{
    userId: string;
    status: 'syncing' | 'completed' | 'partial' | 'failed' | 'refresh_failed' | 'limited' | 'empty';
    message?: string;
    wasPartial?: boolean;
    wasEmpty?: boolean;
    requestId?: string;
    skipped?: number;
  } | null>(null);
  const archidektSyncGeneration = useRef(0);
  const [damagePulse, setDamagePulse] = useState<Record<string, number>>({});
  const [randomHighlight, setRandomHighlight] = useState<ParticipantKey | null>(null);
  const [startingHighlight, setStartingHighlight] = useState<ParticipantKey | null>(null);
  const [pendingEliminate, setPendingEliminate] = useState<ParticipantKey | null>(null);
  const [showEndGame, setShowEndGame] = useState(false);
  const [endWinnerKey, setEndWinnerKey] = useState<ParticipantKey | ''>('');
  const [endIsDraw, setEndIsDraw] = useState(false);
  const [endWinCondition, setEndWinCondition] = useState<WinCondition | null>(null);
  const [endingGame, setEndingGame] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showExitChoice, setShowExitChoice] = useState(false);
  const [discardingGame, setDiscardingGame] = useState(false);
  const [showRematch, setShowRematch] = useState(false);
  const [completedGame, setCompletedGame] = useState<LiveGameRecord | null>(null);
  const [completedDurationSeconds, setCompletedDurationSeconds] = useState(0);
  const [recoveryOutbox, setRecoveryOutbox] = useState<ArchivedLiveGameOperation[]>([]);
  const [showClearRecoveryConfirm, setShowClearRecoveryConfirm] = useState(false);
  const rouletteTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const previousActivePlayerCountRef = useRef<number | null>(null);

  const liveGameRef = useRef<LiveGameRecord | null>(null);
  const serverRecordRef = useRef<LiveGameRecord | null>(null);
  const mutationQueueRef = useRef<QueuedLiveGameMutation[]>([]);
  const needsCreateRef = useRef(false);
  const pendingFinalizationRef = useRef<PendingLiveGameFinalization | null>(null);
  const pendingCancelRef = useRef(false);
  const bootstrappingRef = useRef(true);
  const sessionClosedRef = useRef(false);
  const syncRunningRef = useRef(false);
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncBatchStartedAtRef = useRef<number | null>(null);
  const journalWriteRef = useRef<Promise<void>>(Promise.resolve());
  const historyRef = useRef<LiveGameHistory>(createLiveGameHistory());
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const [syncStatus, setSyncStatus] = useState<'offline' | 'pending' | 'syncing' | 'synced' | 'error'>('synced');
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [localPersistenceAvailable, setLocalPersistenceAvailable] = useState(true);
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(true);
  const publishPendingSyncCount = useCallback(() => {
    setPendingSyncCount(countLiveGamePendingOperations({ mutations: mutationQueueRef.current.length,
      needsCreate: needsCreateRef.current, finalization: Boolean(pendingFinalizationRef.current), cancellation: pendingCancelRef.current }));
  },[]);
  const telemetrySessionRef = useRef(Crypto.randomUUID());

  const openEndGameModal = useCallback((state: LiveGameState) => {
    const suggested = getSuggestedWinner(state);
    setEndWinnerKey(suggested?.participantKey || '');
    setEndIsDraw(false);
    setEndWinCondition(getDefaultWinCondition(state));
    setShowEndGame(true);
  }, []);

  const openDiscardConfirm = useCallback(() => {
    // React Native must never keep two native modals stacked here. The flag
    // flow used to leave the end-game modal mounted below the confirmation,
    // trapping all touches on iOS after the destructive action.
    const next = getDiscardConfirmationVisibility();
    setShowExitChoice(next.showExitChoice);
    setShowEndGame(next.showEndGame);
    setShowDiscardConfirm(next.showDiscardConfirm);
  }, []);

  useEffect(() => {
    if (!liveGame) {
      previousActivePlayerCountRef.current = null;
      return;
    }

    const activePlayerCount = liveGame.state.players.filter((player) => !player.isEliminated).length;
    const previousActivePlayerCount = previousActivePlayerCountRef.current;
    previousActivePlayerCountRef.current = activePlayerCount;

    if (previousActivePlayerCount !== null && previousActivePlayerCount > 1 && activePlayerCount === 1) {
      openEndGameModal(liveGame.state);
    }
  }, [liveGame, openEndGameModal]);

  const handleSelectSetupParticipant = useCallback((participantKey: ParticipantKey) => {
    const generation = ++archidektSyncGeneration.current;
    const targetUserId = participantKey.startsWith('user:')
      ? participantKey.slice('user:'.length)
      : null;
    if (!groupId || !currentUserId || !targetUserId
      || !members.some((member) => member.id === targetUserId && member.archidekt_auto_import)) {
      setArchidektSyncRequest(null);
      return;
    }
    setArchidektSyncRequest({ userId: targetUserId, status: 'syncing' });
    void (async () => {
      try {
        const outcome = await syncAndRefreshArenaMember(groupId, targetUserId, refreshMemberDecks, currentUserId);
        if (generation === archidektSyncGeneration.current) setArchidektSyncRequest({
          userId: targetUserId,
          ...outcome,
          ...(outcome.status === 'partial' ? { message: language === 'it' ? `Sincronizzazione parziale: ${outcome.skipped} ${outcome.skipped === 1 ? 'mazzo non aggiornato' : 'mazzi non aggiornati'}. Riprova.` : `Partial sync: ${outcome.skipped} ${outcome.skipped === 1 ? 'deck was' : 'decks were'} not updated. Retry.` } : {}),
          ...(outcome.status === 'refresh_failed' ? { message: copy('liveGameArchidektSyncRefreshFailed') + (outcome.requestId ? `\n${language === 'it' ? 'Riferimento' : 'Reference'}: ${outcome.requestId}` : '') } : {}),
        });
      } catch (error) {
        const reason = error instanceof ArenaSyncError ? error.reason : 'uncertain';
        const message = reason === 'authentication' ? copy('liveGameArchidektSyncAuth')
          : reason === 'permission' ? copy('liveGameArchidektSyncPermission')
            : reason === 'configuration' ? copy('liveGameArchidektSyncConfiguration')
              : reason === 'rate_limit' ? copy('liveGameArchidektSyncRateLimit')
                : reason === 'upstream' ? copy('liveGameArchidektSyncUpstream')
                  : reason === 'upstream_timeout' ? copy('liveGameArchidektSyncUpstreamTimeout')
                  : reason === 'save' ? copy('liveGameArchidektSyncSave')
                    : copy('liveGameArchidektSyncUncertain');
        if (generation === archidektSyncGeneration.current) {
          const reference = error instanceof ArenaSyncError && error.requestId ? `\n${language === 'it' ? 'Riferimento' : 'Reference'}: ${error.requestId}` : '';
          setArchidektSyncRequest({ userId: targetUserId, status: 'failed', message: message + reference });
        }
      }
    })();
  }, [copy, currentUserId, groupId, language, members, refreshMemberDecks]);

  const handleRetryArchidektSync = useCallback((participantKey: ParticipantKey) => {
    const target = participantKey.startsWith('user:') ? participantKey.slice('user:'.length) : null;
    if (!target || archidektSyncRequest?.userId !== target || archidektSyncRequest.status !== 'refresh_failed') {
      handleSelectSetupParticipant(participantKey);
      return;
    }
    const generation = ++archidektSyncGeneration.current;
    const partial = archidektSyncRequest.wasPartial;
    const empty = archidektSyncRequest.wasEmpty;
    const requestId = archidektSyncRequest.requestId;
    const skipped = archidektSyncRequest.skipped;
    setArchidektSyncRequest({ userId: target, status: 'syncing' });
    void refreshMemberDecks(target).then((limited) => {
      if (generation === archidektSyncGeneration.current) setArchidektSyncRequest({ userId: target, status: partial ? 'partial' : limited ? 'limited' : empty ? 'empty' : 'completed', ...(partial ? { message: language === 'it' ? `Sincronizzazione parziale: ${skipped} ${skipped === 1 ? 'mazzo non aggiornato' : 'mazzi non aggiornati'}. Riprova.` : `Partial sync: ${skipped} ${skipped === 1 ? 'deck was' : 'decks were'} not updated. Retry.` } : {}) });
    }).catch(() => {
      if (generation === archidektSyncGeneration.current) setArchidektSyncRequest({ userId: target, status: 'refresh_failed', wasPartial: partial, wasEmpty: empty, skipped, requestId, message: copy('liveGameArchidektSyncRefreshFailed') + (requestId ? `\n${language === 'it' ? 'Riferimento' : 'Reference'}: ${requestId}` : '') });
    });
  }, [archidektSyncRequest, copy, handleSelectSetupParticipant, language, refreshMemberDecks]);

  const setOptimisticRecord = useCallback((record: LiveGameRecord | null) => {
    if (liveGameRef.current?.id !== record?.id) {
      syncPromiseRef.current = null;
      syncRunningRef.current = false;
    }
    liveGameRef.current = record;
    replaceLiveGameRuntimePlayers(record?.state.players ?? []);
    setLiveGame(record);
  }, []);

  useLayoutEffect(() => {
    bootstrappingRef.current = true;
    syncPromiseRef.current = null;
    syncRunningRef.current = false;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = null;
    journalWriteRef.current = Promise.resolve();
    serverRecordRef.current = null;
    mutationQueueRef.current = [];
    needsCreateRef.current = false;
    pendingFinalizationRef.current = null;
    pendingCancelRef.current = false;
    sessionClosedRef.current = false;
    historyRef.current = createLiveGameHistory();
    setOptimisticRecord(null);
    setBooting(true);
    setRecoveryOutbox([]);
    setUndoDepth(0); setRedoDepth(0); setPendingSyncCount(0);
    setShowEndGame(false); setShowRematch(false); setCompletedGame(null);
    setShowDiscardConfirm(false); setShowExitChoice(false); setShowClearRecoveryConfirm(false);
    setEndWinnerKey(''); setEndIsDraw(false); setEndWinCondition(null);
    setStarting(false); setEndingGame(false); setDiscardingGame(false);
    setPendingEliminate(null); setDamagePulse({}); setRandomHighlight(null); setStartingHighlight(null);
    rouletteTimersRef.current.forEach(clearTimeout); rouletteTimersRef.current = [];
  }, [liveScopeEpoch, setOptimisticRecord]);

  useEffect(() => () => {
    clearLiveGameRuntimePlayers();
  }, [groupId]);

  const saveJournal = useCallback(() => {
    const record = liveGameRef.current;
    const serverRecord = serverRecordRef.current;
    if (!groupId || !record || !serverRecord) return Promise.resolve();
    const snapshot = {
      record,
      serverRecord,
      needsCreate: needsCreateRef.current,
      mutations: [...mutationQueueRef.current],
      pendingFinalization: pendingFinalizationRef.current,
      pendingCancel: pendingCancelRef.current,
      history: historyRef.current,
    };
    publishPendingSyncCount();
    journalWriteRef.current = queueLiveGameJournalWrite(journalWriteRef.current, async () => {
        if (isLiveScopeCurrent() && sessionClosedRef.current) return;
        await saveLiveGameOfflineSession(groupId, snapshot, currentUserId);
      }, saved => {
        if (isLiveScopeCurrent() && !sessionClosedRef.current) setLocalPersistenceAvailable(saved);
      });
    return journalWriteRef.current;
  }, [currentUserId, groupId, isLiveScopeCurrent, publishPendingSyncCount]);

  const flushOutbox = useCallback(async () => {
    if (!isLiveScopeCurrent()) return;
    const bound = bindLiveClient();
    await replayLiveGameOutbox(bound.client, currentUserId ?? '', setRecoveryOutbox, isLiveScopeCurrent,
      matchId => { void apiPost('/api/notifications/match-completed', { matchId }, {
        authenticated: false, headers: { Authorization: `Bearer ${bound.accessToken}` },
      }); });
  }, [bindLiveClient, currentUserId, isLiveScopeCurrent]);

  useEffect(() => {
    let active = true;
    void loadLiveGameOutbox(currentUserId).then(outbox => {
      if (active && isLiveScopeCurrent()) setRecoveryOutbox(outbox);
    }).catch(() => {
      if (active && isLiveScopeCurrent()) {
        setLocalPersistenceAvailable(false);
        setSyncError('LIVE_GAME_OUTBOX_UNAVAILABLE');
      }
    });
    return () => { active = false; };
  }, [currentUserId, isLiveScopeCurrent]);

  const syncJournal = useCallback(() => {
    // Bootstrap owns journal/outbox replacement; reconnect must not sync the
    // old session concurrently while its operations are being archived.
    if (bootstrappingRef.current || !isLiveScopeCurrent()) return Promise.resolve();
    const gameId = liveGameRef.current?.id ?? null;
    const active = () => isLiveScopeCurrent() && (liveGameRef.current?.id ?? null) === gameId;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (syncPromiseRef.current) return syncPromiseRef.current;
    syncRunningRef.current = true;
    setSyncStatus('syncing');
    setSyncError(null);
    let tracked: Promise<void>;
    tracked = (async () => {
      let failed = false;
      let commandClient: ReturnType<typeof bindLiveClient>['client'] | null = null;
      try {
        commandClient = bindLiveClient().client;
        await flushOutbox();
        if (!active() || sessionClosedRef.current) return;
        let serverRecord = serverRecordRef.current;
        if (!serverRecord) return;
        if (needsCreateRef.current) {
          serverRecord = await ensureLiveGameCreated(commandClient, serverRecord);
          if (!active() || sessionClosedRef.current) return;
          serverRecordRef.current = serverRecord;
          needsCreateRef.current = false;
          await saveJournal();
        }

        while (active() && mutationQueueRef.current.length > 0) {
          const batch = mutationQueueRef.current.slice(0, LIVE_GAME_SYNC_BATCH_SIZE);
          serverRecord = await applyQueuedLiveGameMutations(commandClient, serverRecord, batch);
          if (!active() || sessionClosedRef.current) return;
          serverRecordRef.current = serverRecord;
          mutationQueueRef.current = mutationQueueRef.current.slice(batch.length);
          if (mutationQueueRef.current.length === 0) syncBatchStartedAtRef.current = null;
          publishPendingSyncCount();
          setOptimisticRecord(replayQueuedMutations(serverRecord, mutationQueueRef.current));
          await saveJournal();
        }

        if (active() && pendingCancelRef.current) {
          await cancelLiveGame(commandClient, serverRecord.id);
          if (!active()) return;
          pendingCancelRef.current = false;
          await clearLiveGameOfflineSession(groupId, currentUserId);
        }
      } catch (error) {
        if (!active()) return;
        failed = true;
        setAuthenticationRequired(isLiveGameAuthenticationError(error));
        const message = getSupabaseErrorMessage(error, 'Sync failed');
        setSyncError(message);
        recordLiveGameSyncError(new Error(message));
        setSyncStatus('error');
        // Offline, timeout or a transient Realtime gap: the durable journal retries later.
      } finally { if (active()) {
        syncRunningRef.current = false;
        if (!failed) {
          setAuthenticationRequired(false);
          setSyncStatus(mutationQueueRef.current.length ? 'pending' : 'synced');
        }
        if (currentUserId && commandClient) {
          void persistLiveGameTelemetry(commandClient, {
            userId: currentUserId,
            liveGameId: liveGameRef.current?.id ?? null,
            sessionId: telemetrySessionRef.current,
            platform: 'expo',
            force: failed,
          }).catch(() => undefined);
        }
      } }
    })().finally(() => {
      if (syncPromiseRef.current === tracked) syncPromiseRef.current = null;
    });
    syncPromiseRef.current = tracked;
    return tracked;
  }, [bindLiveClient, currentUserId, flushOutbox, groupId, isLiveScopeCurrent, publishPendingSyncCount, saveJournal, setOptimisticRecord]);

  const flushArchivedOutbox = useCallback(() => {
    const pendingSync = syncPromiseRef.current;
    void (pendingSync ?? Promise.resolve())
      .catch(() => undefined)
      .finally(() => {
        void syncJournal();
      });
  }, [syncJournal]);

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    if (mutationQueueRef.current.length === 0) {
      syncTimerRef.current = null;
      syncBatchStartedAtRef.current = null;
      return;
    }
    if (syncBatchStartedAtRef.current === null) syncBatchStartedAtRef.current = Date.now();
    const delay = getLiveGameSyncDelay({
      queueDepth: mutationQueueRef.current.length,
      batchStartedAt: syncBatchStartedAtRef.current,
    });
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      void syncJournal();
    }, delay);
  }, [syncJournal]);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      if (!isLiveScopeCurrent()) return;
      const online = state.isConnected === true && state.isInternetReachable !== false;
      setNetworkOnline(online);
      if (!online) {
        if (syncTimerRef.current) {
          clearTimeout(syncTimerRef.current);
          syncTimerRef.current = null;
        }
        setSyncStatus('offline');
        return;
      }
      void syncJournal();
    });
  }, [isLiveScopeCurrent, syncJournal]);

  // Depend on the stable user id, not the session object: Supabase replaces
  // `user` on every token refresh and the old dependency re-ran this bootstrap
  // mid-game, tearing down the live table when the lookup was transiently empty.
  useEffect(() => {
    if (!groupId || !currentUserId) return;
    bootstrappingRef.current = true;
    let mounted = true;
    void (async () => {
      let cached = await withLiveGameTimeout(
        loadLiveGameOfflineSession(groupId, currentUserId),
        3_000,
      ).catch(() => null);
      if (!mounted || !isLiveScopeCurrent()) return;
      const participantKey = toUserParticipantKey(currentUserId);
      if (cached && !cached.record.state.players.some(
        (player) => player.participantKey === participantKey,
      )) {
        await clearLiveGameOfflineSession(groupId, currentUserId);
        if (!mounted || !isLiveScopeCurrent()) return;
        cached = null;
      }
      if (cached) {
        sessionClosedRef.current = false;
        serverRecordRef.current = cached.serverRecord;
        mutationQueueRef.current = cached.mutations;
        syncBatchStartedAtRef.current = cached.mutations.length ? Date.now() : null;
        needsCreateRef.current = cached.needsCreate;
        pendingFinalizationRef.current = cached.pendingFinalization;
        pendingCancelRef.current = cached.pendingCancel;
        historyRef.current = cached.history;
        setUndoDepth(cached.history.undo.length);
        setRedoDepth(cached.history.redo.length);
        publishPendingSyncCount();
        setSyncStatus(cached.mutations.length ? 'pending' : 'synced');
        setOptimisticRecord(cached.record);
      }

      try {
        const remote = await withLiveGameTimeout(
          fetchActiveLiveGame(bindLiveClient().client, groupId, participantKey),
        );
        if (!mounted || !isLiveScopeCurrent()) return;
        if (remote && (!cached || !cached.needsCreate || remote.id === cached.record.id)) {
          if (cached && remote.id !== cached.record.id) {
            const replacement = await prepareLiveGameReplacement(
              groupId, cached, remote, journalWriteRef.current, currentUserId,
            );
            if (!mounted || !isLiveScopeCurrent()) return;
            // Terminal flags and undo history belong to the archived game.
            // Clear them before installing the new server record or syncing it.
            pendingFinalizationRef.current = replacement.pendingFinalization;
            pendingCancelRef.current = replacement.pendingCancel;
            historyRef.current = replacement.history;
            setUndoDepth(0);
            setRedoDepth(0);
          }
          sessionClosedRef.current = false;
          serverRecordRef.current = remote;
          const queue = cached?.record.id === remote.id ? mutationQueueRef.current : [];
          mutationQueueRef.current = queue;
          syncBatchStartedAtRef.current = queue.length ? Date.now() : null;
          publishPendingSyncCount();
          needsCreateRef.current = false;
          setOptimisticRecord(replayQueuedMutations(remote, queue));
          await saveJournal();
        } else if (!remote && cached && !cached.needsCreate) {
          await clearLiveGameOfflineSession(groupId, currentUserId);
          if (!mounted || !isLiveScopeCurrent()) return;
          serverRecordRef.current = null;
          mutationQueueRef.current = [];
          syncBatchStartedAtRef.current = null;
          setPendingSyncCount(0);
          historyRef.current = createLiveGameHistory();
          setUndoDepth(0);
          setRedoDepth(0);
          setOptimisticRecord(null);
        } else if (!remote && !cached) {
          setOptimisticRecord(null);
        }
      } catch {
        // Cached session remains fully playable while offline.
      } finally {
        if (mounted && isLiveScopeCurrent()) {
          bootstrappingRef.current = false;
          setBooting(false);
          void syncJournal();
        }
      }
    })();
    return () => { mounted = false; };
  }, [bindLiveClient, currentUserId, groupId, isLiveScopeCurrent, publishPendingSyncCount, saveJournal, setOptimisticRecord, syncJournal]);

  const refreshAuthoritativeState = useCallback(async () => {
    const current = liveGameRef.current;
    if (!isLiveScopeCurrent() || !groupId || !currentUserId || !current || needsCreateRef.current || syncRunningRef.current) return;
    const remote = await fetchActiveLiveGame(bindLiveClient().client, groupId, toUserParticipantKey(currentUserId));
    if (!isLiveScopeCurrent() || !remote || remote.id !== current.id || sessionClosedRef.current || liveGameRef.current?.id !== current.id) return;
    serverRecordRef.current = remote;
    setOptimisticRecord(replayQueuedMutations(remote, mutationQueueRef.current));
    await saveJournal();
  }, [bindLiveClient, currentUserId, groupId, isLiveScopeCurrent, saveJournal, setOptimisticRecord]);

  // A single failed boot lookup (network change, timeout, expired session)
  // used to leave the setup screen while the server still considered this
  // player busy in an active game: resume was unavailable and a new game was
  // rejected. Retry the authoritative lookup while no local game is loaded.
  const resumeRemoteGame = useCallback(async () => {
    if (!isLiveScopeCurrent() || bootstrappingRef.current || !groupId || !currentUserId || liveGameRef.current) return;
    // Never resurrect a game that is being finalized or discarded, or one
    // that already produced a recap: the server may still report it active
    // until the queued terminal operation is flushed.
    if (sessionClosedRef.current || pendingFinalizationRef.current || pendingCancelRef.current || completedGame) return;
    const remote = await withLiveGameTimeout(
      fetchActiveLiveGame(bindLiveClient().client, groupId, toUserParticipantKey(currentUserId)),
    );
    if (!isLiveScopeCurrent() || !remote || liveGameRef.current || sessionClosedRef.current || completedGame) return;
    sessionClosedRef.current = false;
    serverRecordRef.current = remote;
    mutationQueueRef.current = [];
    syncBatchStartedAtRef.current = null;
    pendingFinalizationRef.current = null;
    pendingCancelRef.current = false;
    needsCreateRef.current = false;
    historyRef.current = createLiveGameHistory();
    setUndoDepth(0);
    setRedoDepth(0);
    setPendingSyncCount(0);
    setSyncStatus('synced');
    setOptimisticRecord(remote);
    await saveJournal();
    if (isLiveScopeCurrent()) void syncJournal();
  }, [bindLiveClient, completedGame, currentUserId, groupId, isLiveScopeCurrent, saveJournal, setOptimisticRecord, syncJournal]);

  useEffect(() => {
    if (booting || liveGame || completedGame) return undefined;
    const timer = setTimeout(() => {
      void resumeRemoteGame().catch(() => undefined);
    }, 1_500);
    return () => clearTimeout(timer);
  }, [booting, completedGame, liveGame, resumeRemoteGame]);

  useEffect(() => {
    if (!liveGame?.id || needsCreateRef.current) return undefined;
    return subscribeToLiveGame(supabase, liveGame.id, (remote) => {
      if (!isLiveScopeCurrent() || sessionClosedRef.current) return;
      // A channel removal is asynchronous: ignore an event delivered for a
      // previous game after the local session already moved on.
      if (liveGameRef.current?.id !== liveGame.id) return;
      if (remote.status !== 'active') {
        if (pendingFinalizationRef.current || pendingCancelRef.current) return;
        serverRecordRef.current = null;
        mutationQueueRef.current = [];
        syncBatchStartedAtRef.current = null;
        pendingFinalizationRef.current = null;
        pendingCancelRef.current = false;
        setPendingSyncCount(0);
        historyRef.current = createLiveGameHistory();
        setUndoDepth(0);
        setRedoDepth(0);
        setOptimisticRecord(null);
        void clearLiveGameOfflineSession(groupId, currentUserId);
        if (remote.status === 'ended') {
          setCompletedGame(remote);
          setCompletedDurationSeconds(getGameDurationSeconds(remote.started_at, remote.ended_at ?? new Date().toISOString()));
          setShowEndGame(false);
          setShowRematch(true);
          showToast(copy('liveGameSaved'));
        } else {
          router.replace(`/table/${groupId}`);
        }
        return;
      }
      if (syncRunningRef.current) return;
      serverRecordRef.current = remote;
      setOptimisticRecord(replayQueuedMutations(remote, mutationQueueRef.current));
      void saveJournal();
    }, (status) => {
      if (!isLiveScopeCurrent()) return;
      if (status === 'SUBSCRIBED') {
        setSyncStatus(mutationQueueRef.current.length ? 'pending' : 'synced');
        void refreshAuthoritativeState().catch(() => undefined).finally(() => syncJournal());
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setSyncStatus('offline');
      }
    });
  }, [copy, currentUserId, groupId, isLiveScopeCurrent, liveGame?.id, refreshAuthoritativeState, router, saveJournal, setOptimisticRecord, showToast, syncJournal]);

  useEffect(() => {
    const interval = setInterval(() => {
      void NetInfo.fetch().then((state) => {
        if (state.isConnected === true && state.isInternetReachable !== false) {
          void syncJournal();
          void resumeRemoteGame().catch(() => undefined);
          setSetupRetry(current => current + 1);
        }
      });
    }, 10_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void resumeRemoteGame().catch(() => undefined);
        void refreshAuthoritativeState().catch(() => undefined).finally(() => syncJournal());
        if (liveGameRef.current) applyLiveGameImmersive();
      } else if (currentUserId) {
        void persistLiveGameTelemetry(supabase, {
          userId: currentUserId,
          liveGameId: liveGameRef.current?.id ?? null,
          sessionId: telemetrySessionRef.current,
          platform: 'expo',
          force: true,
        }).catch(() => undefined);
      }
    });
    return () => {
      clearInterval(interval);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      appStateSubscription.remove();
    };
  }, [currentUserId, refreshAuthoritativeState, resumeRemoteGame, setSetupRetry, syncJournal]);

  const liveGameId = liveGame?.id ?? null;
  const liveGamePlayerCount = liveGame?.state.players.length ?? 0;

  useEffect(() => {
    if (!liveGameId) {
      void clearLiveGameOrientationLock();
      return undefined;
    }

    void applyLiveGameOrientationLock(liveGamePlayerCount, {
      platform: Platform.OS,
      isPad: Platform.OS === 'ios' && Platform.isPad,
    });
    return () => {
      void clearLiveGameOrientationLock();
    };
  }, [liveGameId, liveGamePlayerCount]);

  useEffect(() => {
    if (!liveGameId) {
      clearLiveGameImmersive();
      return undefined;
    }

    applyLiveGameImmersive();
    return () => {
      clearLiveGameImmersive();
    };
  }, [liveGameId]);

  useFocusEffect(
    useCallback(() => {
      if (liveGameId) {
        void applyLiveGameOrientationLock(liveGamePlayerCount, {
          platform: Platform.OS,
          isPad: Platform.OS === 'ios' && Platform.isPad,
        });
        applyLiveGameImmersive();
      }
      return () => {
        void clearLiveGameOrientationLock();
        clearLiveGameImmersive();
      };
    }, [liveGameId, liveGamePlayerCount]),
  );

  const enqueueMutation = useCallback((
    mutation: LiveGameMutation,
    inverse?: LiveGameMutation,
    historyMode: 'record' | 'skip' = 'record',
  ) => {
    if (sessionClosedRef.current) return;
    const current = liveGameRef.current;
    if (!current) return;
    const id = Crypto.randomUUID();
    const trackedMutation: LiveGameMutation = {
      ...mutation,
      eventId: mutation.eventId ?? id,
      occurredAt: mutation.occurredAt ?? new Date().toISOString(),
    };
    const queued = { id, mutation: trackedMutation };
    if (mutationQueueRef.current.length === 0) syncBatchStartedAtRef.current = Date.now();
    mutationQueueRef.current = [...mutationQueueRef.current, queued];
    publishPendingSyncCount();
    setSyncStatus('pending');
    recordLiveGameQueueDepth(mutationQueueRef.current.length);
    if (inverse && historyMode === 'record') {
      historyRef.current = recordLiveGameHistory(historyRef.current, { forward: mutation, inverse });
      setUndoDepth(historyRef.current.undo.length);
      setRedoDepth(0);
    }
    setOptimisticRecord({ ...current, state: applyLiveGameMutation(current.state, trackedMutation) });
    void saveJournal().then(scheduleSync,scheduleSync);
  }, [publishPendingSyncCount, saveJournal, scheduleSync, setOptimisticRecord]);

  const handleUndo = () => {
    const result = undoLiveGameHistory(historyRef.current);
    if (!result) return;
    historyRef.current = result.history;
    setUndoDepth(result.history.undo.length);
    setRedoDepth(result.history.redo.length);
    enqueueMutation(result.mutation, undefined, 'skip');
    void hapticLight();
  };

  const handleRedo = () => {
    const result = redoLiveGameHistory(historyRef.current);
    if (!result) return;
    historyRef.current = result.history;
    setUndoDepth(result.history.undo.length);
    setRedoDepth(result.history.redo.length);
    enqueueMutation(result.mutation, undefined, 'skip');
    void hapticLight();
  };

  const pulseDamage = useCallback((key: ParticipantKey) => {
    setDamagePulse((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
  }, []);

  const clearRouletteTimers = useCallback(() => {
    rouletteTimersRef.current.forEach(clearTimeout);
    rouletteTimersRef.current = [];
  }, []);

  useEffect(() => clearRouletteTimers, [clearRouletteTimers]);

  const runRoulette = useCallback((
    pool: ParticipantKey[],
    winner: ParticipantKey,
    tone: 'random' | 'starting',
  ) => {
    clearRouletteTimers();
    setRandomHighlight(null);
    setStartingHighlight(null);
    const sequence = buildRouletteSequence(pool, winner);
    const setHighlight = tone === 'starting' ? setStartingHighlight : setRandomHighlight;
    sequence.forEach((key, index) => {
      rouletteTimersRef.current.push(setTimeout(() => {
        setHighlight(key);
        if (index === sequence.length - 1) void hapticSuccess();
      }, index * 120));
    });
    rouletteTimersRef.current.push(setTimeout(() => {
      setHighlight(null);
      rouletteTimersRef.current = [];
    }, (sequence.length - 1) * 120 + 4200));
  }, [clearRouletteTimers]);

  const revealStartingPlayer = useCallback((key: ParticipantKey | null, pool: ParticipantKey[]) => {
    if (!key) return;
    runRoulette(pool, key, 'starting');
  }, [runRoulette]);

  const resolveMeta = (key: ParticipantKey) => {
    const parsed = parseParticipantKey(key);
    if (!parsed) return null;
    const deckId = participantDecks[key];
    const deck = getDeckOptions(key).find((entry) => entry.id === deckId);
    if (!deck) return null;

    if (parsed.type === 'user') {
      const member = members.find((entry) => entry.id === parsed.id);
      if (!member) return null;
      return {
        key,
        deckId: deck.id,
        displayName: getProfileDisplayName(member),
        commander: deck.commander,
        commanderImage: deck.commander_image,
        isGuest: false,
        userId: parsed.id,
        guestId: null,
      };
    }

    const guest = guests.find((entry) => entry.id === parsed.id);
    if (!guest) return null;
    return {
      key,
      deckId: deck.id,
      displayName: guest.display_name,
      commander: deck.commander,
      commanderImage: deck.commander_image,
      isGuest: true,
      userId: null,
      guestId: parsed.id,
    };
  };

  const handleStart = async () => {
    if (!isLiveScopeCurrent()) return;
    if (setupReadyKey !== `${user?.id}:${groupId}`) return;
    if (!user) return;
    if (selectedKeys.length !== playerCount) {
      showToast(copy('liveGameFillSeats'));
      return;
    }

    const missingDeck = selectedKeys.find((key) => {
      const options = getDeckOptions(key);
      return options.length > 0 && !participantDecks[key];
    });
    if (missingDeck) {
      showToast(copy('liveGameDeckError'));
      return;
    }

    const resolvedPlayers = selectedKeys.map((key) => ({ key, meta: resolveMeta(key) }));
    if (resolvedPlayers.some((entry) => !entry.meta)) {
      showToast(copy('liveGameDeckError'));
      return;
    }

    const command = beginLiveCommand();
    if (!command) return;
    setStarting(true);
    try {
      try {
        const busyKeys = await withLiveGameTimeout(
          fetchBusyLiveGameParticipantKeys(bindLiveClient().client, groupId, selectedKeys),
        );
        if (!command.isCurrent()) return;
        if (busyKeys.length > 0) {
          showToast(copy('liveGamePlayersBusy'));
          return;
        }
      } catch {
        // Offline starts remain available; the durable outbox will retry later.
      }
      if (!command.isCurrent()) return;

      const created = createLiveGameRound({
        id: Crypto.randomUUID(), groupId, actorId: user.id, startedAt: new Date().toISOString(),
        startingLife, layoutVariant, random: Math.random,
        seats: resolvedPlayers.map(({key, meta}) => ({participantKey: key, deckId: meta!.deckId,
          displayName: meta!.displayName, commander: meta!.commander, commanderImage: meta!.commanderImage})),
      });
      sessionClosedRef.current = false;
      serverRecordRef.current = created;
      mutationQueueRef.current = [];
      syncBatchStartedAtRef.current = null;
      setPendingSyncCount(0);
      historyRef.current = createLiveGameHistory();
      setUndoDepth(0);
      setRedoDepth(0);
      needsCreateRef.current = true;
      pendingFinalizationRef.current = null;
      pendingCancelRef.current = false;
      setOptimisticRecord(created);
      await saveLiveGameSetup(groupId, user.id, {
        playerCount,
        layoutVariant,
        startingLife,
        seats: seatSetups,
      }).catch(() => undefined);
      if (!command.isCurrent()) return;
      revealStartingPlayer(created.state.startingPlayerKey ?? null, selectedKeys);
      await saveJournal();
      if (!command.isCurrent()) return;
      void syncJournal();
      showToast(copy('liveGameStarted'));
    } catch {
      if (command.isCurrent()) showToast(copy('liveGameStartFailed'));
    } finally {
      if (command.isCurrent()) setStarting(false);
      command.release();
    }
  };

  const handleAdjust = (playerKey: ParticipantKey, delta: number) => {
    if (delta < 0) {
      pulseDamage(playerKey);
      void (Math.abs(delta) >= 10 ? hapticMedium() : hapticLight());
    }
    const mutation: LiveGameMutation = {
      type: 'adjust',
      targetKey: playerKey,
      // UI deltas describe the life-total change, while positive mutations describe damage.
      amount: -delta,
      mode: 'life',
    };
    const player = liveGameRef.current?.state.players.find(
      (entry) => entry.participantKey === playerKey,
    );
    enqueueMutation(mutation, player ? { type: 'restore-player', player } : undefined);
  };

  const handleApplyDragDamage = (input: {
    sourceKey: ParticipantKey;
    targetKey: ParticipantKey;
    amount: number;
    mode: DamageMode;
    scope: 'single' | import('@/lib/live-game').GroupDamageScope;
    drain: boolean;
  }) => {
    if (input.sourceKey === input.targetKey || input.amount <= 0) return;
    const effectiveScope = input.drain && input.scope === 'all_players' ? 'opponents' : input.scope;
    if (effectiveScope !== 'single' && input.mode !== 'commander') {
      const targets = liveGameRef.current?.state.players
        .filter((player) => !player.isEliminated && (effectiveScope === 'all_players' || player.participantKey !== input.sourceKey)) ?? [];
      targets.forEach((player) => pulseDamage(player.participantKey));
      const drainAmount = input.drain ? input.amount * targets.length : undefined;
      enqueueMutation({
        type: 'adjust_many',
        sourceKey: input.sourceKey,
        amount: input.amount,
        scope: effectiveScope,
        mode: input.mode,
        drain: input.drain,
        drainAmount,
      }, {
        type: 'adjust_many',
        sourceKey: input.sourceKey,
        amount: -input.amount,
        scope: effectiveScope,
        mode: input.mode,
        drain: input.drain,
        drainAmount,
      });
    } else {
      pulseDamage(input.targetKey);
      const mutation: LiveGameMutation = {
        type: 'adjust',
        targetKey: input.targetKey,
        amount: input.amount,
        mode: input.mode,
        sourceKey: input.sourceKey,
        drain: input.drain,
        drainAmount: input.drain ? input.amount : undefined,
      };
      const player = liveGameRef.current?.state.players.find(
        (entry) => entry.participantKey === input.targetKey,
      );
      enqueueMutation(mutation, input.drain
        ? {
          type: 'adjust',
          targetKey: input.targetKey,
          sourceKey: input.sourceKey,
          amount: -input.amount,
          mode: input.mode,
          drain: true,
          drainAmount: input.amount,
        }
        : player ? { type: 'restore-player', player } : undefined);
    }
    hapticSuccess();
  };

  const runRandomPick = (pool?: ParticipantKey[]) => {
    if (!liveGame) return;
    const picked = pickRandomPlayer(liveGame.state, pool);
    if (!picked) return;
    const eligibleKeys = pool?.length
      ? pool
      : liveGame.state.players
        .filter((player) => !player.isEliminated)
        .map((player) => player.participantKey);
    runRoulette(eligibleKeys, picked.participantKey, 'random');
  };

  const handleDiscardGame = async () => {
    if (!liveGame || discardingGame || sessionClosedRef.current) return;
    const command = beginLiveCommand();
    if (!command) return;

    setDiscardingGame(true);
    sessionClosedRef.current = true;
    pendingCancelRef.current = true;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    try {
      const pendingJournal = journalWriteRef.current;
      const serverRecord = serverRecordRef.current ?? liveGame;
      await archiveAndClearLiveGameSession(groupId, {
        id: liveGame.id,
        serverRecord,
        needsCreate: needsCreateRef.current,
        mutations: mutationQueueRef.current,
        finalization: null,
        cancel: true,
      }, currentUserId);
      void pendingJournal
        .catch(() => undefined)
        .finally(() => clearLiveGameOfflineSessionIfMatches(groupId, liveGame.id, currentUserId))
        .catch(() => undefined);
      if (!command.isCurrent()) return;
      serverRecordRef.current = null;
      mutationQueueRef.current = [];
      syncBatchStartedAtRef.current = null;
      setPendingSyncCount(0);
      historyRef.current = createLiveGameHistory();
      setUndoDepth(0);
      setRedoDepth(0);
      needsCreateRef.current = false;
      pendingCancelRef.current = false;
      setOptimisticRecord(null);
      flushArchivedOutbox();
      hapticSuccess();
      showToast(copy('liveGameDiscarded'));
      router.replace(`/table/${groupId}`);
    } catch {
      if (!command.isCurrent()) return;
      sessionClosedRef.current = false;
      pendingCancelRef.current = false;
      void saveJournal();
      showToast(copy('liveGameDiscardFailed'));
    } finally {
      if (command.isCurrent()) {
        setDiscardingGame(false);
        setShowDiscardConfirm(false);
        setShowEndGame(false);
      }
      command.release();
    }
  };

  const handleEndGame = async () => {
    if (!isLiveScopeCurrent()) return;
    if (!user || !liveGame || endingGame || sessionClosedRef.current) return;
    if (!endIsDraw && !endWinnerKey) {
      showToast(copy('liveGameWinnerError'));
      return;
    }
    if (!endIsDraw && activePlayers.length !== 1 && !endWinCondition) {
      showToast(copy('liveGameWinConditionError'));
      return;
    }
    if (!isValidLiveGameResult(liveGame.state, {
      winnerKey: endIsDraw ? null : endWinnerKey || null,
      isDraw: endIsDraw,
      winCondition: endIsDraw ? null : endWinCondition,
    })) {
      showToast(copy('liveGameWinConditionError'));
      return;
    }

    const command = beginLiveCommand();
    if (!command) return;
    setEndingGame(true);
    try {
      if (!endIsDraw && endWinCondition === 'last_standing' && activePlayers.length > 1 && endWinnerKey) {
        activePlayers
          .filter((player) => player.participantKey !== endWinnerKey)
          .forEach((player) => pulseDamage(player.participantKey));
        enqueueMutation({ type: 'last_standing', winnerKey: endWinnerKey });
      }

      const finalizedGame = liveGameRef.current ?? liveGame;
      const players = finalizedGame.state.players.map((player: LiveGamePlayer) => {
        const parsed = parseParticipantKey(player.participantKey);
        return {
          participantKey: player.participantKey,
          deckId: player.deckId,
          isGuest: parsed?.type === 'guest',
          userId: parsed?.type === 'user' ? parsed.id : null,
          guestId: parsed?.type === 'guest' ? parsed.id : null,
        };
      });

      const pending: PendingLiveGameFinalization = {
        winnerKey: endIsDraw ? null : endWinnerKey,
        isDraw: endIsDraw,
        winCondition: endIsDraw
          ? null
          : activePlayers.length === 1 ? 'last_standing' : endWinCondition,
        endedAt: new Date().toISOString(),
        players,
      };
      sessionClosedRef.current = true;
      pendingFinalizationRef.current = pending;
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }

      const durationSeconds = getGameDurationSeconds(liveGame.started_at, pending.endedAt);
      setCompletedDurationSeconds(durationSeconds);

      setCompletedGame(finalizedGame);
      const pendingJournal = journalWriteRef.current;
      await archiveAndClearLiveGameSession(groupId, {
        id: liveGame.id,
        serverRecord: serverRecordRef.current ?? liveGame,
        needsCreate: needsCreateRef.current,
        mutations: mutationQueueRef.current,
        finalization: pending,
        cancel: false,
      }, currentUserId);
      void pendingJournal
        .catch(() => undefined)
        .finally(() => clearLiveGameOfflineSessionIfMatches(groupId, liveGame.id, currentUserId))
        .catch(() => undefined);
      if (!command.isCurrent()) return;
      serverRecordRef.current = null;
      mutationQueueRef.current = [];
      syncBatchStartedAtRef.current = null;
      setPendingSyncCount(0);
      historyRef.current = createLiveGameHistory();
      setUndoDepth(0);
      setRedoDepth(0);
      needsCreateRef.current = false;
      pendingFinalizationRef.current = null;
      setOptimisticRecord(null);
      flushArchivedOutbox();

      hapticSuccess();
      showToast(`${endIsDraw ? copy('liveGameSavedDraw') : copy('liveGameSaved')} · ${formatGameDuration(durationSeconds)}`);
      setShowRematch(true);
    } catch {
      if (!command.isCurrent()) return;
      sessionClosedRef.current = false;
      pendingFinalizationRef.current = null;
      void saveJournal();
      showToast(copy('liveGameSaveFailed'));
    } finally {
      if (command.isCurrent()) {
        setEndingGame(false);
        setShowEndGame(false);
      }
      command.release();
    }
  };

  const preparePreviousPod = useCallback(() => {
    const previous = completedGame;
    if (!previous) return null;
    const orderedPlayers = [...previous.state.players].sort((a, b) => a.slot - b.slot);
    setPlayerCount(orderedPlayers.length);
    setLayoutVariant(previous.state.layoutVariant ?? 'classic');
    applySeatSetups(orderedPlayers.map((player) => ({
      participantKey: player.participantKey,
      deckId: player.deckId,
    })));
    applyStartingLife(previous.starting_life);
    return previous;
  }, [applySeatSetups, applyStartingLife, completedGame, setLayoutVariant, setPlayerCount]);

  const handleRematchSameDecks = useCallback(async () => {
    if (!user || !isLiveScopeCurrent()) return;
    const command = beginLiveCommand();
    if (!command) return;
    try {
      const previous = preparePreviousPod();
      if (!previous) return;
      const keys = previous.state.players.map((player) => player.participantKey);
      const record = createLiveGameRound({
        id: Crypto.randomUUID(), groupId, actorId: user.id, startedAt: new Date().toISOString(),
        startingLife: previous.starting_life, layoutVariant: previous.state.layoutVariant ?? 'classic',
        seats: previous.state.players, random: Math.random,
      });
      sessionClosedRef.current = false;
      serverRecordRef.current = record;
      mutationQueueRef.current = [];
      syncBatchStartedAtRef.current = null;
      setPendingSyncCount(0);
      historyRef.current = createLiveGameHistory();
      setUndoDepth(0);
      setRedoDepth(0);
      needsCreateRef.current = true;
      setOptimisticRecord(record);
      revealStartingPlayer(record.state.startingPlayerKey ?? null, keys);
      setShowRematch(false);
      await saveJournal();
      if (!command.isCurrent()) return;
      void syncJournal();
    } finally { command.release(); }
  }, [beginLiveCommand, groupId, isLiveScopeCurrent, preparePreviousPod, revealStartingPlayer, saveJournal, setOptimisticRecord, syncJournal, user]);

  const handleRematchReselect = useCallback(() => {
    preparePreviousPod();
    setShowRematch(false);
  }, [preparePreviousPod]);

  if (loading || booting) {
    return <ArenaSkeleton contentStyle={scrollContentStyle} />;
  }

  const gameState = liveGame?.state;
  const presentationPendingCount = countLiveGamePendingOperations({ mutations: pendingSyncCount,
    needsCreate: false, finalization: false, cancellation: false,
    archivedOperations: recoveryOutbox.reduce((count,item) => count + countLiveGamePendingOperations({ mutations: item.mutations.length,
      needsCreate: item.needsCreate, finalization: Boolean(item.finalization), cancellation: item.cancel }),0),
  });
  const presentationState = getLiveGameSyncState({ pendingOperations: presentationPendingCount,
    online: networkOnline && syncStatus !== 'offline', syncing: syncStatus === 'syncing', localPersistenceAvailable,
    authenticationRequired, hasError: syncError !== null,
  });
  const presentationCopy = getLiveGameSyncCopy(presentationState,language);
  const visibleSyncError = syncError === 'LIVE_GAME_OUTBOX_UNAVAILABLE'
    ? getLiveGameSyncCopy('storage_unavailable', language).label : syncError;
  const activePlayers = (gameState?.players ?? []).filter((player: LiveGamePlayer) => !player.isEliminated);
  const endGameWarnings = gameState ? getLiveGameResultWarnings(gameState, {
    winnerKey: endIsDraw ? null : endWinnerKey || null,
    isDraw: endIsDraw,
    winCondition: endIsDraw ? null : endWinCondition,
  }) : [];
  const requiresAlternativeWinCondition = !endIsDraw && activePlayers.length !== 1;
  const pendingEliminatePlayer = gameState?.players.find(
    (player) => player.participantKey === pendingEliminate,
  );

  if (liveGame) {
    return (
      <View style={styles.immersiveRoot}>
        <StatusBar hidden />
        <TableArena
          players={gameState?.players ?? []}
          startedAt={liveGame.started_at}
          layoutVariant={gameState?.layoutVariant ?? 'classic'}
          randomHighlight={randomHighlight}
          startingPlayerKey={gameState?.startingPlayerKey ?? null}
          startingHighlight={startingHighlight}
          startingDirection={gameState?.startingDirection ?? null}
          damagePulse={damagePulse}
          activePlayers={activePlayers}
          labels={{
            damageLife: copy('liveGameDamageLife'),
            damageCommander: copy('liveGameDamageCommander'),
            damageInfect: copy('liveGameDamageInfect'),
            randomAll: copy('liveGameRandomAll'),
            randomOpponents: copy('liveGameRandomOpponents'),
            selectActivePlayer: copy('liveGameSelectActivePlayer'),
            dragDamage: copy('liveGameDragDamage'),
            dropDamage: copy('liveGameDropDamage'),
            damageConfirmTitle: copy('liveGameDamageConfirmTitle'),
            damageAmount: copy('liveGameDamageAmount'),
            lifeDamage: copy('liveGameLifeDamage'),
            commanderDamage: copy('liveGameCommanderDamage'),
            applyDamage: copy('liveGameApplyDamage'),
            cancel: copy('cancel'),
            commanderDamageMeta: copy('liveGameCommanderDamage'),
            infect: copy('liveGameInfect'),
            eliminated: copy('liveGameEliminated'),
            revive: copy('liveGameRevive'),
            selected: copy('liveGameSelected'),
            ko: copy('liveGameKo'),
            endGame: copy('liveGameEnd'),
            startingPlayer: copy('liveGameStartingPlayer'),
            clockwise: copy('liveGameClockwise'),
            counterclockwise: copy('liveGameCounterclockwise'),
            damageReceived: copy('liveGameDamageReceived'),
            undo: copy('liveGameUndo'),
            redo: copy('liveGameRedo'),
            thisPlayer: copy('liveGameThisPlayer'),
            eachOpponent: copy('liveGameEachOpponent'),
            everyone: copy('liveGameEveryone'),
            drain: copy('liveGameDrain'),
            drainHint: copy('liveGameDrainHint'),
            lifelink: copy('liveGameLifelink'),
            lifelinkHint: copy('liveGameLifelinkHint'),
            dieOrCoin: copy('dieOrCoin'),
            coin: copy('coin'),
            heads: copy('heads'),
            tails: copy('tails'),
          }}
          onBack={() => setShowExitChoice(true)}
          canUndo={undoDepth > 0}
          onUndo={handleUndo}
          canRedo={redoDepth > 0}
          onRedo={handleRedo}
          syncStatus={getLiveGameSyncIndicator(presentationState)}
          syncLabel={presentationCopy.label}
          pendingSyncCount={presentationPendingCount}
          syncError={presentationCopy.hint || (!localPersistenceAvailable ? presentationCopy.label : visibleSyncError)}
          onRetrySync={() => void syncJournal()}
          onEndGame={() => openEndGameModal(liveGame.state)}
          onAdjust={handleAdjust}
          onApplyDragDamage={handleApplyDragDamage}
          onEliminate={setPendingEliminate}
          onRevive={(key) => {
            const player = liveGame.state.players.find((entry) => entry.participantKey === key);
            if (!player) return;
            enqueueMutation(
              { type: 'revive', targetKey: key, startingLife: liveGame.starting_life },
              { type: 'restore-player', player },
            );
          }}
          onPickRandom={runRandomPick}
          onAdjustCounter={(key, counter, amount) => enqueueMutation(
            { type: 'adjust_counter', targetKey: key, counter, amount },
            { type: 'adjust_counter', targetKey: key, counter, amount: -amount },
          )}
          onSetEmblem={(key, emblem, active) => {
            const holderKey = liveGame.state.players.find((player) => player.counters[emblem])?.participantKey ?? null;
            enqueueMutation(
              { type: 'set_emblem', targetKey: key, emblem, active },
              { type: 'restore_emblem', emblem, holderKey },
            );
          }}
        />

        <Modal
          visible={showExitChoice}
          onClose={() => setShowExitChoice(false)}
          presentation="dialog"
          maxWidth={520}
          scroll={false}
        >
          <ModalHeader
            title={copy('liveGameExitTitle')}
            subtitle={copy('liveGameExitHint')}
            icon={null}
            onClose={() => setShowExitChoice(false)}
          />
          <View style={styles.exitChoiceGrid}>
            <Pressable
              style={({ pressed }) => [styles.exitChoice, styles.pauseChoice, pressed && styles.choicePressed]}
              onPress={() => {
                setShowExitChoice(false);
                router.back();
              }}
            >
              <View style={[styles.exitChoiceIcon, styles.pauseChoiceIcon]}>
                <Ionicons name="pause" size={22} color={colors.primaryLight} />
              </View>
              <View style={styles.exitChoiceCopy}>
                <Text style={styles.exitChoiceTitle}>{copy('liveGamePause')}</Text>
                <Text style={styles.exitChoiceHint}>
                  {copy('resumeGameHint')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.exitChoice, styles.discardChoice, pressed && styles.choicePressed]}
              onPress={openDiscardConfirm}
            >
              <View style={[styles.exitChoiceIcon, styles.discardChoiceIcon]}>
                <Ionicons name="trash-outline" size={21} color="#fca5a5" />
              </View>
              <View style={styles.exitChoiceCopy}>
                <Text style={[styles.exitChoiceTitle, styles.discardChoiceTitle]}>{copy('liveGameDiscard')}</Text>
                <Text style={styles.exitChoiceHint}>{copy('liveGameDiscardConfirm')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="rgba(252,165,165,0.72)" />
            </Pressable>
          </View>
        </Modal>

        <ConfirmModal
          visible={Boolean(pendingEliminate)}
          title={copy('liveGameConfirmEliminate')}
          message={pendingEliminatePlayer
            ? `${pendingEliminatePlayer.displayName}\n${copy('liveGameEliminateHint')}`
            : copy('liveGameEliminateHint')}
          icon="skull-outline"
          tone="danger"
          onClose={() => setPendingEliminate(null)}
          actions={[
            { label: copy('cancel'), variant: 'ghost', onPress: () => setPendingEliminate(null) },
            {
              label: copy('liveGameEliminate'),
              variant: 'destructive',
              onPress: () => {
                if (!pendingEliminate) return;
                void hapticWarning();
                const player = liveGame.state.players.find(
                  (entry) => entry.participantKey === pendingEliminate,
                );
                enqueueMutation(
                  {
                    type: 'eliminate',
                    targetKey: pendingEliminate,
                    eliminatedAt: new Date().toISOString(),
                  },
                  player ? { type: 'restore-player', player } : undefined,
                );
                setPendingEliminate(null);
              },
            },
          ]}
        />

        <Modal
          visible={showEndGame}
          onClose={() => setShowEndGame(false)}
          presentation="dialog"
          maxWidth={560}
          footer={(
            <View style={styles.modalActions}>
              <Button
                label={copy('cancel')}
                variant="outline"
                onPress={() => setShowEndGame(false)}
                style={styles.modalButton}
              />
              <Button
                label={endingGame ? copy('liveGameSaving') : copy('liveGameConfirmSave')}
                icon="checkmark-circle-outline"
                onPress={handleEndGame}
                disabled={endingGame
                  || discardingGame
                  || (!endIsDraw && !endWinnerKey)
                  || (requiresAlternativeWinCondition && !endWinCondition)}
                style={styles.modalButton}
              />
            </View>
          )}
        >
          <ModalHeader
            title={copy('liveGameWhoWon')}
            subtitle={copy('liveGameEndGameHint')}
            icon="trophy-outline"
            tone="success"
            onClose={() => setShowEndGame(false)}
          />
          <View style={styles.winConditionHeading}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>1</Text>
            </View>
            <Text style={styles.winConditionTitle}>{copy('liveGameWhoWon')}</Text>
          </View>
          <Pressable
            style={[styles.drawOption, endIsDraw && styles.winnerOptionActive]}
            onPress={() => {
              setEndIsDraw((value) => !value);
              setEndWinnerKey('');
              setEndWinCondition(null);
              void hapticLight();
            }}
          >
            <View style={styles.drawIcon}>
              <Ionicons name="remove" size={22} color={endIsDraw ? colors.primaryMuted : colors.muted} />
            </View>
            <View style={styles.winnerCopy}>
              <Text style={styles.winnerOptionText}>{copy('liveGameDraw')}</Text>
              <Text style={styles.winnerOptionMeta}>{copy('liveGameDrawHint')}</Text>
            </View>
            <Ionicons
              name={endIsDraw ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={endIsDraw ? colors.primaryLight : colors.muted}
            />
          </Pressable>
          {!endIsDraw ? activePlayers.map((player: LiveGamePlayer) => (
            <Pressable
              key={player.participantKey}
              style={[styles.winnerOption, endWinnerKey === player.participantKey && styles.winnerOptionActive]}
              onPress={() => {
                setEndIsDraw(false);
                setEndWinnerKey(player.participantKey);
                setEndWinCondition(activePlayers.length === 1 ? 'last_standing' : null);
                void hapticLight();
              }}
            >
              <DeckImage
                uri={player.commanderImage}
                alt={player.commander}
                style={styles.winnerImage}
                containerStyle={styles.winnerImageWrap}
                contentPosition="top"
              />
              <View style={styles.winnerCopy}>
                <Text style={styles.winnerOptionText} numberOfLines={1}>{player.displayName}</Text>
                <Text style={styles.winnerOptionMeta} numberOfLines={1}>{player.commander}</Text>
              </View>
              <Ionicons
                name={endWinnerKey === player.participantKey ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={endWinnerKey === player.participantKey ? colors.primaryLight : colors.muted}
              />
            </Pressable>
          )) : null}
          {!endIsDraw && endWinnerKey ? (
            <View style={styles.winConditionSection}>
              <View style={styles.winConditionHeading}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>2</Text>
                </View>
                <View style={styles.winConditionHeadingCopy}>
                  <Text style={styles.winConditionTitle}>{copy('liveGameWinCondition')}</Text>
                  <Text style={styles.winConditionHint}>
                    {requiresAlternativeWinCondition
                      ? copy('liveGameWinConditionHint')
                      : copy('liveGameWinLastStandingHint')}
                  </Text>
                </View>
              </View>
              {requiresAlternativeWinCondition ? (
                <View style={styles.winConditionGrid}>
                  {WIN_CONDITIONS.filter((condition) => (
                    condition.value !== 'last_standing' || featureFlags?.lastStanding !== false
                  )).map((condition) => {
                    const selected = endWinCondition === condition.value;
                    return (
                      <Pressable
                        key={condition.value}
                        onPress={() => {
                          setEndWinCondition(condition.value);
                          void hapticLight();
                        }}
                        style={({ pressed }) => [
                          styles.winConditionOption,
                          selected && styles.winConditionOptionActive,
                          pressed && styles.choicePressed,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                      >
                        <View style={[styles.winConditionIcon, selected && styles.winConditionIconActive]}>
                          <Ionicons
                            name={condition.icon}
                            size={20}
                            color={selected ? colors.primaryLight : colors.muted}
                          />
                        </View>
                        <Text style={styles.winConditionOptionTitle}>{copy(condition.labelKey)}</Text>
                        <Text style={styles.winConditionOptionHint} numberOfLines={2}>{copy(condition.hintKey)}</Text>
                        <Ionicons
                          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                          size={19}
                          color={selected ? colors.primaryLight : colors.border}
                          style={styles.winConditionCheck}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.lastStandingCard}>
                  <Ionicons name="shield-checkmark-outline" size={21} color="#86efac" />
                  <Text style={styles.lastStandingText}>{copy('liveGameWinLastStanding')}</Text>
                  <Ionicons name="checkmark-circle" size={20} color="#86efac" />
                </View>
              )}
            </View>
          ) : null}
          {endGameWarnings.length > 0 ? (
            <View style={styles.resultWarning}>
              <Ionicons name="warning-outline" size={18} color="#fcd34d" />
              <Text style={styles.resultWarningText}>{endGameWarnings.map((warning) => (
                warning === 'draw_with_single_survivor'
                  ? (language === 'it' ? 'È rimasto un solo giocatore: verifica che sia davvero un pareggio.' : 'Only one player remains: verify this is really a draw.')
                  : (language === 'it' ? 'Il vincitore ha già un valore letale o risulta eliminato.' : 'The winner already has a lethal total or is marked eliminated.')
              )).join(' ')}</Text>
            </View>
          ) : null}
          <Pressable
            onPress={openDiscardConfirm}
            disabled={endingGame || discardingGame}
            style={styles.discardButton}
          >
            <Ionicons name="trash-outline" size={16} color={colors.destructive} />
            <Text style={styles.discardButtonText}>
              {discardingGame ? copy('liveGameDiscarding') : copy('liveGameDiscard')}
            </Text>
          </Pressable>
        </Modal>

        <ConfirmModal
          visible={showDiscardConfirm}
          title={copy('liveGameDiscard')}
          message={copy('liveGameDiscardConfirm')}
          icon="trash-outline"
          tone="danger"
          onClose={() => setShowDiscardConfirm(false)}
          actions={[
            { label: copy('cancel'), variant: 'ghost', onPress: () => setShowDiscardConfirm(false) },
            {
              label: discardingGame ? copy('liveGameDiscarding') : copy('liveGameDiscard'),
              variant: 'destructive',
              onPress: handleDiscardGame,
              disabled: discardingGame,
            },
          ]}
        />
      </View>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <View style={styles.topBar}>
        <Pressable style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={colors.primaryMuted} />
          <Text style={styles.backLabel}>{group?.name || copy('table')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[scrollContentStyle, styles.content]}>
          {recoveryOutbox.length > 0 ? (
            <LiveGameRecoveryPanel count={recoveryOutbox.length} language={language} syncing={syncStatus === 'syncing'}
              error={visibleSyncError} onSync={() => void syncJournal()} onDiscard={() => setShowClearRecoveryConfirm(true)} />
          ) : null}
          <PhyrexianPanel style={styles.setupPanel}>
            <Text style={styles.setupTitle}>{copy('liveGameSetupTitle')}</Text>
            <Text style={styles.setupHint}>{copy('liveGameSetupHint')}</Text>

            <SetupRestoreGate ready={setupReadyKey === `${user?.id}:${groupId}`} error={setupRestoreError} language={language} onRetry={() => setSetupRetry(current => current + 1)}>
            <LiveGameConfigurator
              groupId={groupId}
              onOccasionalDeckCreated={deck => setOccasionalDecks(current => [...current.filter(item => item.id !== deck.id), deck])}
              playerCount={playerCount}
              layoutVariant={layoutVariant}
              seats={seatSetups}
              startingLife={startingLife}
              participants={setupParticipants}
              onPlayerCountChange={handlePlayerCountChange}
              onLayoutChange={setLayoutVariant}
              onStartingLifeChange={applyStartingLife}
              onSelectParticipant={handleSelectSetupParticipant}
              onRetryArchidektSync={handleRetryArchidektSync}
              archidektSyncRequest={archidektSyncRequest}
              onAssignSeat={handleAssignSeat}
              onReset={resetSetup}
              onStart={handleStart}
              starting={starting}
              labels={{
                playerCount: copy('liveGamePlayerCount'),
                layout: copy('liveGameLayout'),
                classic: copy('liveGameLayoutClassic'),
                opposed: copy('liveGameLayoutOpposed'),
                seats: copy('liveGameSeats'),
                seat: copy('liveGameSeat'),
                emptySeat: copy('liveGameEmptySeat'),
                choosePlayer: copy('liveGameChoosePlayer'),
                chooseDeck: copy('liveGameChooseDeck'),
                archidektSyncWaiting: copy('liveGameArchidektSyncWaiting'),
                archidektSyncCompleted: copy('liveGameArchidektSyncCompleted'),
                archidektSyncPartial: copy('liveGameArchidektSyncPartial'),
                archidektSyncLimited: copy('liveGameArchidektSyncLimited'),
                archidektSyncEmpty: copy('liveGameArchidektSyncEmpty'),
                archidektSyncRetry: copy('liveGameArchidektSyncRetry'),
                archidektSyncRefreshRetry: copy('liveGameArchidektSyncRefreshRetry'),
                archidektSyncFailed: copy('liveGameArchidektSyncFailed'),
                searchDecks: copy('searchDecks'),
                noDecksMatchSearch: copy('noDecksMatchSearch'),
                clearSeat: copy('liveGameClearSeat'),
                confirm: copy('confirm'),
                reset: copy('liveGameResetSetup'),
                startingLife: copy('liveGameStartingLife'),
                custom: copy('liveGameCustom'),
                back: copy('back'),
                next: copy('next'),
                start: copy('liveGameStart'),
                starting: copy('liveGameStarting'),
              }}
            />

            </SetupRestoreGate>
          </PhyrexianPanel>
      </ScrollView>
      <ConfirmModal
        visible={showClearRecoveryConfirm}
        title={language === 'it' ? 'Scartare i recuperi?' : 'Discard recovery data?'}
        message={language === 'it' ? 'I salvataggi non ancora sincronizzati verranno rimossi definitivamente.' : 'Unsynced saves will be permanently removed.'}
        icon="warning-outline"
        tone="danger"
        onClose={() => setShowClearRecoveryConfirm(false)}
        actions={[{ label: copy('cancel'), variant: 'ghost', onPress: () => setShowClearRecoveryConfirm(false) }, { label: language === 'it' ? 'Scarta' : 'Discard', variant: 'destructive', onPress: () => { void saveLiveGameOutbox([], currentUserId); setRecoveryOutbox([]); setShowClearRecoveryConfirm(false); } }]}
      />
      <Modal
        visible={showRematch}
        onClose={() => setShowRematch(false)}
        presentation="dialog"
        maxWidth={500}
        footer={(
          <Button
            label={copy('liveGameDone')}
            variant="ghost"
            onPress={() => router.replace(`/table/${groupId}`)}
          />
        )}
      >
        <ModalHeader
          title={copy('liveGameAgainTitle')}
          subtitle={`${copy('liveGameAgainHint')}\n${copy('liveGameDuration')}: ${formatGameDuration(completedDurationSeconds)}`}
          icon="refresh-outline"
          onClose={() => setShowRematch(false)}
        />
        {completedGame ? (
          <LiveGameRecapView
            record={completedGame}
            labels={{
              timeline: copy('liveGameLifeTimeline'),
              highlights: copy('liveGameHighlights'),
              empty: copy('liveGameLogEmpty'),
            }}
          />
        ) : null}
        <View style={styles.rematchActions}>
          <Button
            label={copy('liveGameSameDecks')}
            icon="layers-outline"
            onPress={handleRematchSameDecks}
          />
          <Button
            label={copy('liveGameReselectDecks')}
            icon="albums-outline"
            variant="outline"
            onPress={handleRematchReselect}
          />
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backLabel: {
    color: colors.primaryMuted,
    fontSize: 14,
    fontWeight: '600',
  },

  content: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  setupPanel: {
    gap: spacing.md,
  },
  setupTitle: {
    color: colors.foreground,
    fontSize: 22,
    fontWeight: '700',
  },
  setupHint: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionLabel: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  resultWarning: { flexDirection: 'row', gap: spacing.sm, borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)', borderRadius: radii.md, backgroundColor: 'rgba(245,158,11,0.1)', padding: spacing.sm },
  resultWarningText: { flex: 1, color: '#fde68a', fontSize: 11, lineHeight: 16 },
  rematchActions: {
    gap: spacing.sm,
  },
  configSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  configSectionLabel: {
    flex: 1,
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '600',
  },
  playerCountHint: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  lifePill: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  lifePillActive: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(14, 165, 233, 0.15)',
  },
  lifePillText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  lifePillTextActive: {
    color: '#7dd3fc',
  },
  presetButton: {
    flex: 1,
  },
  immersiveRoot: {
    flex: 1,
    backgroundColor: '#050508',
  },
  exitChoiceGrid: {
    gap: spacing.sm,
  },
  exitChoice: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  pauseChoice: {
    borderColor: colors.selectionBorder,
    backgroundColor: colors.selectionTint,
  },
  discardChoice: {
    borderColor: 'rgba(248,113,113,0.34)',
    backgroundColor: 'rgba(127,29,29,0.13)',
  },
  exitChoiceIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseChoiceIcon: {
    backgroundColor: colors.selectionTintStrong,
  },
  discardChoiceIcon: {
    backgroundColor: 'rgba(127,29,29,0.3)',
  },
  exitChoiceCopy: {
    flex: 1,
    gap: 2,
  },
  exitChoiceTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '800',
  },
  discardChoiceTitle: {
    color: '#fecaca',
  },
  exitChoiceHint: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
  },
  drawOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.cardInset,
    padding: spacing.sm,
  },
  drawIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceChip,
  },
  winnerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.cardInset,
    padding: spacing.sm,
  },
  winnerOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.selectionTint,
  },
  winnerOptionText: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '800',
  },
  choicePressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  winnerOptionMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  winnerCopy: {
    flex: 1,
    minWidth: 0,
  },
  winnerImageWrap: {
    width: 42,
    height: 56,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  winnerImage: {
    width: 42,
    height: 56,
  },
  winConditionSection: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  winConditionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  stepBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  winConditionHeadingCopy: {
    flex: 1,
  },
  winConditionTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '900',
  },
  winConditionHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  winConditionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  winConditionOption: {
    position: 'relative',
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 118,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardInset,
    padding: spacing.md,
    gap: 5,
  },
  winConditionOptionActive: {
    borderColor: colors.primaryLight,
    backgroundColor: colors.selectionTint,
  },
  winConditionIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceChip,
  },
  winConditionIconActive: {
    backgroundColor: colors.selectionTintStrong,
  },
  winConditionOptionTitle: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: '900',
  },
  winConditionOptionHint: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 14,
  },
  winConditionCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  lastStandingCard: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.30)',
    backgroundColor: 'rgba(22, 101, 52, 0.18)',
    paddingHorizontal: spacing.md,
  },
  lastStandingText: {
    flex: 1,
    color: '#dcfce7',
    fontSize: 13,
    fontWeight: '800',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modalButton: {
    flex: 1,
  },
  discardButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
  },
  discardButtonText: {
    color: colors.destructive,
    fontSize: 13,
    fontWeight: '700',
  },
});
