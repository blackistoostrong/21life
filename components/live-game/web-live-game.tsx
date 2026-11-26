'use client';

import { createLiveGameRound } from '@/lib/live-game-round';

import { useCallback, useEffect, useRef, useState } from 'react';
import {useCommandScope} from '@/hooks/use-command-scope';
import {createWebLiveCommandClient} from '@/lib/web-live-command-client';
import { useRouter } from 'next/navigation';
import type { WebTrackerParticipant } from '@/lib/types/web-tracker';
import { useWebTrackerSetup } from '@/hooks/use-web-tracker-setup';
import { WebTrackerWizard } from '@/components/live-game/web-tracker-wizard';
import { useWebTrackerDisplay } from '@/hooks/use-web-tracker-display';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Crown,
  Box,
  Dices,
  Flag,
  Heart,
  Loader2,
  Maximize2,
  Minus,
  MoreHorizontal,
  Pause,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Trophy,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { useRuntimeConfig } from '@/components/runtime-config-provider';
import { Button } from '@/components/ui/button';
import { HoldActionButton } from '@/components/ui/hold-action-button';
import { DeckImage } from '@/components/deck-image';
import { LiveGameModalTitle } from '@/components/live-game/live-game-modal-title';
import { WebCompletedGame } from '@/components/live-game/web-completed-game';
import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  applyLiveGameMutation,
  getDefaultWinCondition,
  getLiveGameResultWarnings,
  getSuggestedWinner,
  isValidLiveGameResult,
  pickRandomPlayer,
  type DamageMode,
  type GroupDamageScope,
  type LiveGameMutation,
  type LiveGameRecord,
  type QueuedLiveGameMutation,
  type WinCondition,
} from '@/lib/live-game';
import { rollTableRandom, type TableRandomKind } from '@/lib/table-randomizer';
import {
  getLandscapeSeatRotation,
  getCenterToolbarBand,
  getSeatRotation,
  getSquareTableLayouts,
  getViewportTableOrientation,
  mapPlayersToSeats,
  type TableLayoutVariant,
} from '@/lib/live-game-table-layout';
import { buildRouletteSequence } from '@/lib/live-game-roulette';
import {
  applyQueuedLiveGameMutations,
  cancelLiveGame,
  ensureLiveGameCreated,
  fetchActiveLiveGame,
  fetchBusyLiveGameParticipantKeys,
  finalizeLiveGameAsMatch,
  subscribeToLiveGame,
} from '@/lib/live-game-service';
import {
  clearWebLiveGameJournal,
  loadWebLiveGameJournal,
  saveWebLiveGameJournal,
  type PendingLiveGameFinalization,
} from '@/lib/live-game-offline';
import {
  createLiveGameHistory,
  recordLiveGameHistory,
  redoLiveGameHistory,
  undoLiveGameHistory,
  type LiveGameHistory,
} from '@/lib/live-game-history';
import { persistLiveGameTelemetry, recordLiveGameQueueDepth } from '@/lib/live-game-telemetry';
import { WebJournalWarning } from '@/components/live-game/web-journal-warning';
import { WebSyncBadge } from '@/components/live-game/web-sync-badge';
import { countLiveGamePendingOperations, getLiveGameSyncState, isLiveGameAuthenticationError } from '@/lib/live-game-sync-presentation';
import type { WebJournalError } from '@/lib/live-game-offline';
import { webJournalHasPendingOperations } from '@/lib/live-game-journal-contract';
import type { WebLiveGameSeatSetup } from '@/lib/live-game-setup';
import type { ParticipantKey } from '@/lib/participant-keys';
import { LifeReadout } from '@/components/ui/recent-life-delta';
import { useScreenWakeLock } from '@/hooks/use-screen-wake-lock';
import {
  LIVE_GAME_SYNC_BATCH_SIZE,
  getLiveGameSyncDelay,
} from '@/lib/live-game-sync-policy';
import {withRequestDeadline} from '@/packages/data/request-deadline';


export type { WebTrackerDeck, WebTrackerParticipant } from '@/lib/types/web-tracker';

type DragState = {
  sourceKey: ParticipantKey;
  startX: number;
  startY: number;
  x: number;
  y: number;
  targetKey: ParticipantKey | null;
};

type DamageDraft = {
  sourceKey: ParticipantKey;
  targetKey: ParticipantKey;
  mode: DamageMode;
  scope: 'single' | GroupDamageScope;
  drain: boolean;
};

const WIN_CONDITIONS: Array<{
  value: WinCondition;
  label: { it: string; en: string };
  icon: typeof Sparkles;
}> = [
  { value: 'last_standing', label: { it: 'Ultimo in piedi', en: 'Last Standing' }, icon: Shield },
  { value: 'combo', label: { it: 'Combo', en: 'Combo' }, icon: Sparkles },
  { value: 'concession', label: { it: 'Resa avversari', en: 'Opponents conceded' }, icon: Flag },
  { value: 'alternate_card', label: { it: 'Vittoria alternativa', en: 'Alternate card win' }, icon: Trophy },
  { value: 'other', label: { it: 'Altro', en: 'Other' }, icon: MoreHorizontal },
];

function secureRandom() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0]! / 0x1_0000_0000;
}

function replay(record: LiveGameRecord, queue: QueuedLiveGameMutation[]) {
  return queue.reduce(
    (current, item) => ({ ...current, state: applyLiveGameMutation(current.state, item.mutation) }),
    record,
  );
}

function formatDuration(startedAt: string | null, endedAt?: string) {
  if (!startedAt) return '00:00';
  const endTime = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((endTime - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}


export function WebLiveGame({
  groupId,
  arenaName,
  userId,
  participants: catalogParticipants,
}: {
  groupId: string;
  arenaName: string;
  userId: string;
  participants: WebTrackerParticipant[];
}) {
  const {begin:beginLiveJob,committed:isLiveCurrent,cancel:cancelLiveJob}=useCommandScope<'sync'|'refresh'|'bootstrap'|'command'|'telemetry'>(`${userId}:${groupId}`,true);
  const setup = useWebTrackerSetup(groupId, userId, catalogParticipants);
  const { participants, occasionalCreationBusy, playerCount, layoutVariant, startingLife, seats,
    restoreSetup, persistSetup } = setup;
  const router = useRouter();
  const { copy } = useLanguage();
  const { toast } = useToast();
  const [booting, setBooting] = useState(true);
  const [record, setRecord] = useState<LiveGameRecord | null>(null);
  const recordRef = useRef<LiveGameRecord | null>(null);
  const serverRef = useRef<LiveGameRecord | null>(null);
  const queueRef = useRef<QueuedLiveGameMutation[]>([]);
  const needsCreateRef = useRef(false);
  const pendingFinalizationRef = useRef<PendingLiveGameFinalization | null>(null);
  const pendingCancelRef = useRef(false);
  const historyRef = useRef<LiveGameHistory>(createLiveGameHistory());
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const syncingRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const syncBatchStartedAtRef = useRef<number | null>(null);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [localSaveError, setLocalSaveError] = useState<WebJournalError | null>(null);
  const [recoveryIssue, setRecoveryIssue] = useState<WebJournalError | null>(null);
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const [liveOnboardingOpen, setLiveOnboardingOpen] = useState(false);
  const [recoveredJournal, setRecoveredJournal] = useState(false);
  const telemetrySessionRef = useRef(globalThis.crypto.randomUUID());
  const [duration, setDuration] = useState('00:00');
  useScreenWakeLock(Boolean(record));

  const [starting, setStarting] = useState(false);
  const [damageDraft, setDamageDraft] = useState<DamageDraft | null>(null);
  const [damageAmount, setDamageAmount] = useState('0');
  const [damagePanelKey, setDamagePanelKey] = useState<ParticipantKey | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [highlight, setHighlight] = useState<ParticipantKey | null>(null);
  const [randomOpponentMode, setRandomOpponentMode] = useState(false);
  const [randomizerOpen, setRandomizerOpen] = useState(false);
  const [randomizerResult, setRandomizerResult] = useState<string | number | null>(null);
  const rouletteTimers = useRef<number[]>([]);
  const [endOpen, setEndOpen] = useState(false);
  const [winnerKey, setWinnerKey] = useState<ParticipantKey | ''>('');
  const [isDraw, setIsDraw] = useState(false);
  const [winCondition, setWinCondition] = useState<WinCondition | null>(null);
  const [ending, setEnding] = useState(false);
  const { featureFlags } = useRuntimeConfig();
  const [completedRecord, setCompletedRecord] = useState<LiveGameRecord | null>(null);
  const [completedDuration, setCompletedDuration] = useState('00:00');
  const durationRef = useRef('00:00');
  const syncPresentationStatus = getLiveGameSyncState({ pendingOperations: pendingSyncCount, online, syncing,
    localPersistenceAvailable: localSaveError === null, authenticationRequired, hasError: syncError !== null });
  const [confirmEliminate, setConfirmEliminate] = useState<ParticipantKey | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [exitChoiceOpen, setExitChoiceOpen] = useState(false);
  const previousActivePlayerCountRef = useRef<number | null>(null);
  const { tableRef, tableSize, fullscreen, enterTrackerLandscape, restoreDefaultTrackerDisplay } =
    useWebTrackerDisplay(record, recordRef, copy, toast);

  const setOptimisticRecord = useCallback((next: LiveGameRecord | null) => {
    recordRef.current = next;
    setRecord(next);
  }, []);

  const persist = useCallback((next = recordRef.current) => {
    if (!next || !serverRef.current) return;
    const result = saveWebLiveGameJournal(groupId, {
      record: next,
      serverRecord: serverRef.current,
      needsCreate: needsCreateRef.current,
      mutations: queueRef.current,
      pendingFinalization: pendingFinalizationRef.current,
      pendingCancel: pendingCancelRef.current,
      history: historyRef.current,
    }, userId);
    setLocalSaveError(result.ok ? null : result.error);
    setPendingSyncCount(countLiveGamePendingOperations({ mutations: queueRef.current.length, needsCreate: needsCreateRef.current,
      finalization: Boolean(pendingFinalizationRef.current), cancellation: pendingCancelRef.current }));
  }, [groupId, userId]);

  const clearJournal = useCallback((liveGameId: string) => {
    const result = clearWebLiveGameJournal(groupId, userId, liveGameId);
    setLocalSaveError(result.ok ? null : result.error);
  }, [groupId, userId]);

  const showCompletedGame = useCallback((completed: LiveGameRecord, endedAt: string) => {
    setCompletedDuration(formatDuration(completed.started_at, endedAt));
    setCompletedRecord(completed);
    serverRef.current = null;
    queueRef.current = [];
    syncBatchStartedAtRef.current = null;
    needsCreateRef.current = false;
    historyRef.current = createLiveGameHistory();
    setUndoDepth(0);
    setRedoDepth(0);
    setPendingSyncCount(0);
    setOptimisticRecord(null);
    setEndOpen(false);
  }, [setEndOpen, setOptimisticRecord]);

  const clearCancelledGame = useCallback(() => {
    serverRef.current = null;
    queueRef.current = [];
    syncBatchStartedAtRef.current = null;
    needsCreateRef.current = false;
    historyRef.current = createLiveGameHistory();
    setUndoDepth(0);
    setRedoDepth(0);
    setPendingSyncCount(0);
    setOptimisticRecord(null);
    setConfirmCancel(false);
  }, [setConfirmCancel, setOptimisticRecord]);

  const flush = useCallback(async () => {
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (!isLiveCurrent() || syncingRef.current || !recordRef.current || !serverRef.current || !navigator.onLine) return false;
    const job=beginLiveJob('sync');
    if(!job)return false;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    let failed = false;
    let commandClient: Awaited<ReturnType<typeof createWebLiveCommandClient>>|null=null;
    try {
      commandClient=await createWebLiveCommandClient(userId,job.signal);
      if(!job.active())return false;
      const {client,accessToken}=commandClient;
      let server = serverRef.current;
      if (needsCreateRef.current) {
        server = await ensureLiveGameCreated(client, recordRef.current);
        if(!job.active())return false;
        serverRef.current = server;
        needsCreateRef.current = false;
      }
      while (queueRef.current.length > 0) {
        const batch = queueRef.current.slice(0, LIVE_GAME_SYNC_BATCH_SIZE);
        server = await applyQueuedLiveGameMutations(client, server, batch);
        if(!job.active())return false;
        serverRef.current = server;
        queueRef.current = queueRef.current.slice(batch.length);
        if (queueRef.current.length === 0) syncBatchStartedAtRef.current = null;
        setPendingSyncCount(queueRef.current.length);
        setOptimisticRecord(replay(server, queueRef.current));
        persist(recordRef.current);
      }
      if (pendingFinalizationRef.current) {
        const completed = recordRef.current;
        const finalization = pendingFinalizationRef.current;
        const matchId = await finalizeLiveGameAsMatch(client, {
          liveGameId: server.id,
          ...finalization,
        });
        if(!job.active())return false;
        void withRequestDeadline({abortSignal:signal=>fetch('/api/notifications/match-completed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          signal,
          body: JSON.stringify({ matchId }),
        })},5000,job.signal).catch(()=>undefined);
        pendingFinalizationRef.current = null;
        clearJournal(server.id);
        if (completed) showCompletedGame(completed, finalization.endedAt);
        return true;
      }
      if (pendingCancelRef.current) {
        await cancelLiveGame(client, server.id);
        if(!job.active())return false;
        pendingCancelRef.current = false;
        clearJournal(server.id);
        clearCancelledGame();
        return true;
      }
      persist(recordRef.current);
      return true;
    } catch (error) {
      if(!job.active())return false;
      failed = true;
      setAuthenticationRequired(isLiveGameAuthenticationError(error));
      persist(recordRef.current);
      setSyncError(error instanceof Error ? error.message : 'Sync failed');
      console.error('Web live-game sync failed', error);
      return false;
    } finally {
      if(job.active()){
      syncingRef.current = false;
      setSyncing(false);
      if (!failed) setAuthenticationRequired(false);
      if(commandClient)void persistLiveGameTelemetry(commandClient.client, {
        userId,
        liveGameId: recordRef.current?.id ?? null,
        sessionId: telemetrySessionRef.current,
        platform: 'web',
        force: failed,
      }).catch(() => undefined);
      }
      job.finish();
    }
  }, [beginLiveJob, isLiveCurrent, clearCancelledGame, clearJournal, persist, setOptimisticRecord, showCompletedGame, userId]);

  const scheduleFlush = useCallback(() => {
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    if (queueRef.current.length > 0 && syncBatchStartedAtRef.current === null) {
      syncBatchStartedAtRef.current = Date.now();
    }
    const delay = getLiveGameSyncDelay({
      queueDepth: queueRef.current.length,
      batchStartedAt: syncBatchStartedAtRef.current,
    });
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      void flush();
    }, delay);
  }, [flush]);

  const refreshAuthoritativeState = useCallback(async () => {
    const current = recordRef.current;
    if (!current || needsCreateRef.current || syncingRef.current) return;
    const job=beginLiveJob('refresh');
    if(!job)return;
    try{
    const {client}=await createWebLiveCommandClient(userId,job.signal);
    if(!job.active())return;
    const remote = await fetchActiveLiveGame(client,groupId,`user:${userId}` as ParticipantKey,job.signal);
    if(!job.active())return;
    if (!remote || remote.id !== current.id || recordRef.current?.id !== current.id) return;
    serverRef.current = remote;
    setOptimisticRecord(replay(remote, queueRef.current));
    persist(recordRef.current);
    }finally{job.finish();}
  }, [beginLiveJob,groupId, persist, setOptimisticRecord, userId]);

  useEffect(() => {
    if (queueRef.current.length > 0) scheduleFlush();
    return () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [scheduleFlush]);

  const sendBackgroundTelemetry=useCallback(()=>{
    const job=beginLiveJob('telemetry');
    if(!job)return;
    void createWebLiveCommandClient(userId,job.signal).then(({client})=>{
      if(!job.active())return;
      return persistLiveGameTelemetry(client,{
        userId,liveGameId:recordRef.current?.id??null,
        sessionId:telemetrySessionRef.current,platform:'web',force:true,
      });
    }).catch(()=>undefined).finally(()=>job.finish());
  },[beginLiveJob,userId]);

  useEffect(() => {
    const flushBeforeBackground = () => {
      if (document.visibilityState === 'hidden') {
        if (queueRef.current.length > 0) void flush();
        sendBackgroundTelemetry();
      } else {
        void refreshAuthoritativeState().catch(() => undefined).finally(() => {if(isLiveCurrent())void flush();});
      }
    };
    const flushBeforeExit = () => {
      if (queueRef.current.length > 0) void flush();
    };
    document.addEventListener('visibilitychange', flushBeforeBackground);
    window.addEventListener('pagehide', flushBeforeExit);
    return () => {
      document.removeEventListener('visibilitychange', flushBeforeBackground);
      window.removeEventListener('pagehide', flushBeforeExit);
    };
  }, [flush,isLiveCurrent, refreshAuthoritativeState,sendBackgroundTelemetry]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => {
      setOnline(true);
      void refreshAuthoritativeState().catch(() => undefined).finally(() => {if(isLiveCurrent())void flush();});
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flush,isLiveCurrent, refreshAuthoritativeState]);

  useEffect(() => {
    const job=beginLiveJob('bootstrap');
    if(!job)return;
    let mounted = true;
    void (async () => {
      const participantKey = `user:${userId}` as ParticipantKey;
      const loaded = loadWebLiveGameJournal(groupId, userId);
      const cached = loaded.journal;
      setRecoveryIssue(loaded.error);
      if (cached && (cached.record.created_by === userId || cached.record.state.players.some((player) => player.participantKey === participantKey))) {
        setRecoveredJournal(true);
        serverRef.current = cached.serverRecord;
        queueRef.current = cached.mutations;
        syncBatchStartedAtRef.current = cached.mutations.length ? Date.now() : null;
        needsCreateRef.current = cached.needsCreate;
        pendingFinalizationRef.current = cached.pendingFinalization;
        pendingCancelRef.current = cached.pendingCancel;
        historyRef.current = cached.history;
        setUndoDepth(cached.history.undo.length);
        setRedoDepth(cached.history.redo.length);
        setPendingSyncCount(countLiveGamePendingOperations({ mutations: cached.mutations.length, needsCreate: cached.needsCreate,
          finalization: Boolean(cached.pendingFinalization), cancellation: cached.pendingCancel }));
        setOptimisticRecord(cached.record);
      }
      try {
        const {client}=await createWebLiveCommandClient(userId,job.signal);
        if(!job.active())return;
        if (cached && (cached.pendingFinalization || cached.pendingCancel) && navigator.onLine) {
          const terminalOperationRecovered = await flush();
          if(!job.active())return;
          if (terminalOperationRecovered) return;
        }
        const remote = await fetchActiveLiveGame(client, groupId, participantKey,job.signal);
        if (!mounted||!job.active()) return;
        if (remote) {
          if (cached && cached.record.id !== remote.id && webJournalHasPendingOperations(cached)) {
            setRecoveryIssue('pending_game');
            return;
          }
          if (cached?.record.id !== remote.id) {
            pendingFinalizationRef.current = null;
            pendingCancelRef.current = false;
            historyRef.current = createLiveGameHistory();
            setUndoDepth(0);
            setRedoDepth(0);
          }
          const queue = cached?.record.id === remote.id ? queueRef.current : [];
          serverRef.current = remote;
          queueRef.current = queue;
          syncBatchStartedAtRef.current = queue.length ? Date.now() : null;
          setPendingSyncCount(queue.length);
          needsCreateRef.current = false;
          setOptimisticRecord(replay(remote, queue));
          persist(recordRef.current);
          void flush();
        } else if (cached && !cached.needsCreate) {
          if (webJournalHasPendingOperations(cached)) { setRecoveryIssue('pending_game'); return; }
          clearJournal(cached.record.id);
          serverRef.current = null;
          queueRef.current = [];
          syncBatchStartedAtRef.current = null;
          setOptimisticRecord(null);
        } else if (cached?.needsCreate) {
          persist(cached.record);
          void flush();
        }
      } catch {
        // The crash-safe local journal remains playable offline.
      } finally {
        if (mounted&&job.active())setBooting(false);
        job.finish();
      }
    })();
    return () => { mounted = false; cancelLiveJob('bootstrap'); };
  }, [beginLiveJob,cancelLiveJob,clearJournal, flush, groupId, persist, setOptimisticRecord, userId]);

  const activeRecordId = record?.id;
  useEffect(() => {
    if (!activeRecordId) return;
    try { if (localStorage.getItem('live-onboarding-v1')) return; }
    catch { /* Onboarding preferences are optional; the journal reports storage failure. */ }
    const timer = window.setTimeout(() => setLiveOnboardingOpen(true), 4_500);
    return () => window.clearTimeout(timer);
  }, [activeRecordId]);
  useEffect(() => {
    if (!activeRecordId || needsCreateRef.current) return;
    let active=true;
    const stop=subscribeToLiveGame(supabase, activeRecordId, (remote) => {
      if(!active||!isLiveCurrent())return;
      // Ignore events from a channel whose removal is still in flight.
      if (recordRef.current?.id !== activeRecordId) return;
      if (remote.status !== 'active') {
        if (pendingFinalizationRef.current || pendingCancelRef.current) return;
        if (needsCreateRef.current || queueRef.current.length > 0) {
          setRecoveryIssue('pending_game');
          return;
        }
        serverRef.current = null;
        queueRef.current = [];
        syncBatchStartedAtRef.current = null;
        pendingFinalizationRef.current = null;
        pendingCancelRef.current = false;
        clearJournal(remote.id);
        setOptimisticRecord(null);
        if (remote.status === 'ended') {
          setCompletedRecord(remote);
          setCompletedDuration(durationRef.current);
          toast({ title: copy({ it: 'Partita conclusa su un altro dispositivo', en: 'Game ended on another device' }) });
        } else {
          router.replace(`/table/${groupId}`);
        }
        return;
      }
      if (syncingRef.current) return;
      serverRef.current = remote;
      setOptimisticRecord(replay(remote, queueRef.current));
      persist(recordRef.current);
    }, (status) => {
      if (active&&isLiveCurrent()&&status === 'SUBSCRIBED') {
        void refreshAuthoritativeState().catch(() => undefined).finally(() => {if(isLiveCurrent())void flush();});
      }
    });
    return ()=>{active=false;stop();};
  }, [activeRecordId, clearJournal, copy, flush, groupId,isLiveCurrent, persist, refreshAuthoritativeState, router, setOptimisticRecord, toast]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    if (!record?.started_at) return;
    setDuration(formatDuration(record.started_at));
    const timer = window.setInterval(() => setDuration(formatDuration(record.started_at)), 1000);
    return () => window.clearInterval(timer);
  }, [record?.started_at]);

  const startGame = async (override?: {
    playerCount: number;
    layoutVariant: TableLayoutVariant;
    startingLife: number;
    seats: WebLiveGameSeatSetup[];
  }) => {
    const nextPlayerCount = override?.playerCount ?? playerCount;
    const nextLayoutVariant = override?.layoutVariant ?? layoutVariant;
    const nextStartingLife = override?.startingLife ?? startingLife;
    if (occasionalCreationBusy) return;
    const nextSeats = override?.seats ?? seats;
    const selected = nextSeats.filter((seat) => seat.participantKey && seat.deckId);
    if (selected.length !== nextPlayerCount || new Set(selected.map((seat) => seat.participantKey)).size !== nextPlayerCount) {
      toast({ title: copy({ it: 'Completa tutti i posti', en: 'Complete every seat' }), variant: 'destructive' });
      return;
    }
    const job=beginLiveJob('command');
    if(!job)return;
    enterTrackerLandscape();
    setStarting(true);
    try {
      const keys = selected.map((seat) => seat.participantKey!) as ParticipantKey[];
      if (navigator.onLine) {
        const {client}=await createWebLiveCommandClient(userId,job.signal);
        if(!job.active())return;
        const busy = await fetchBusyLiveGameParticipantKeys(client, groupId, keys);
        if(!job.active())return;
        if (busy.length) throw new Error(copy({ it: 'Uno dei giocatori è già in una partita attiva.', en: 'A player is already in another active game.' }));
      }
      const created = createLiveGameRound({
        id: crypto.randomUUID(), groupId, actorId: userId, startedAt: new Date().toISOString(),
        startingLife: nextStartingLife, layoutVariant: nextLayoutVariant, random: secureRandom,
        seats: selected.map(seat => {
          const participant = participants.find(entry => entry.key === seat.participantKey)!;
          const deck = participant.decks.find(entry => entry.id === seat.deckId)!;
          return {participantKey: participant.key, deckId: deck.id, displayName: participant.displayName,
            commander: deck.commander, commanderImage: deck.commanderImage};
        }),
      });
      serverRef.current = created;
      queueRef.current = [];
      syncBatchStartedAtRef.current = null;
      setPendingSyncCount(0);
      historyRef.current = createLiveGameHistory();
      setUndoDepth(0);
      setRedoDepth(0);
      needsCreateRef.current = true;
      pendingFinalizationRef.current = null;
      pendingCancelRef.current = false;
      setCompletedRecord(null);
      setOptimisticRecord(created);
      try {
        persistSetup({
          playerCount: nextPlayerCount,
          layoutVariant: nextLayoutVariant,
          startingLife: nextStartingLife,
          seats: nextSeats,
        });
      } catch { setLocalSaveError('unavailable'); }
      persist(created);
      runRoulette(keys, created.state.startingPlayerKey!);
      void flush();
    } catch (error) {
      if(!job.active())return;
      restoreDefaultTrackerDisplay();
      toast({ title: copy({ it: 'Partita non avviata', en: 'Game not started' }), description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      if(job.active())setStarting(false);
      job.finish();
    }
  };

  const enqueue = useCallback((
    mutation: LiveGameMutation,
    inverse?: LiveGameMutation,
    historyMode: 'record' | 'skip' = 'record',
  ) => {
    const current = recordRef.current;
    if (!current) return;
    const id = crypto.randomUUID();
    const tracked: LiveGameMutation = {
      ...mutation,
      eventId: mutation.eventId ?? id,
      occurredAt: mutation.occurredAt ?? new Date().toISOString(),
    };
    if (queueRef.current.length === 0) syncBatchStartedAtRef.current = Date.now();
    queueRef.current = [...queueRef.current, { id, mutation: tracked }];
    setPendingSyncCount(queueRef.current.length);
    recordLiveGameQueueDepth(queueRef.current.length);
    if (inverse && historyMode === 'record') {
      historyRef.current = recordLiveGameHistory(historyRef.current, { forward: mutation, inverse });
      setUndoDepth(historyRef.current.undo.length);
      setRedoDepth(0);
    }
    const next = { ...current, state: applyLiveGameMutation(current.state, tracked) };
    setOptimisticRecord(next);
    persist(next);
    scheduleFlush();
  }, [persist, scheduleFlush, setOptimisticRecord]);

  const undoLastMutation = () => {
    const result = undoLiveGameHistory(historyRef.current);
    if (!result) return;
    historyRef.current = result.history;
    setUndoDepth(result.history.undo.length);
    setRedoDepth(result.history.redo.length);
    enqueue(result.mutation, undefined, 'skip');
  };

  const redoLastMutation = () => {
    const result = redoLiveGameHistory(historyRef.current);
    if (!result) return;
    historyRef.current = result.history;
    setUndoDepth(result.history.undo.length);
    setRedoDepth(result.history.redo.length);
    enqueue(result.mutation, undefined, 'skip');
  };

  const runRoulette = (pool: ParticipantKey[], winner?: ParticipantKey) => {
    rouletteTimers.current.forEach(window.clearTimeout);
    rouletteTimers.current = [];
    const picked = winner ?? pickRandomPlayer(recordRef.current!.state, pool)?.participantKey;
    if (!picked) return;
    const sequence = buildRouletteSequence(pool, picked);
    sequence.forEach((key, index) => {
      rouletteTimers.current.push(window.setTimeout(() => setHighlight(key), index * 120));
    });
    rouletteTimers.current.push(window.setTimeout(() => setHighlight(null), sequence.length * 120 + 4000));
  };

  const selectRandomOpponent = (activeKey: ParticipantKey) => {
    if (!record) return;
    const pool = record.state.players
      .filter((player) => !player.isEliminated && player.participantKey !== activeKey)
      .map((player) => player.participantKey);
    setRandomOpponentMode(false);
    runRoulette(pool);
  };

  const beginDamageDrag = (event: React.PointerEvent<HTMLElement>, sourceKey: ParticipantKey) => {
    if (randomOpponentMode || event.button !== 0) return;
    setDrag({
      sourceKey,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      targetKey: null,
    });
  };

  const dragging = Boolean(drag);
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-player-key]');
      const key = element?.dataset.playerKey as ParticipantKey | undefined;
      setDrag((current) => current ? {
        ...current,
        x: event.clientX,
        y: event.clientY,
        targetKey: key && key !== current.sourceKey ? key : null,
      } : null);
    };
    const up = () => {
      setDrag((current) => {
        if (current?.targetKey) {
          setDamageDraft({ sourceKey: current.sourceKey, targetKey: current.targetKey, mode: 'life', scope: 'single', drain: false });
          setDamageAmount('0');
        }
        return null;
      });
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging]);

  const applyDamageDraft = () => {
    const currentRecord = recordRef.current;
    if (!damageDraft || !currentRecord) return;
    const amount = Math.max(0, Math.min(999, Number(damageAmount) || 0));
    if (amount === 0) return;
    const effectiveScope = damageDraft.drain && damageDraft.scope === 'all_players'
      ? 'opponents'
      : damageDraft.scope;
    if (effectiveScope !== 'single' && damageDraft.mode !== 'commander') {
      const targetCount = effectiveScope === 'all_players'
        ? currentRecord.state.players.filter((player) => !player.isEliminated).length
        : currentRecord.state.players.filter((player) => !player.isEliminated && player.participantKey !== damageDraft.sourceKey).length;
      const drainAmount = damageDraft.drain ? amount * targetCount : undefined;
      enqueue({
        type: 'adjust_many',
        sourceKey: damageDraft.sourceKey,
        amount,
        scope: effectiveScope,
        mode: damageDraft.mode,
        drain: damageDraft.drain,
        drainAmount,
      }, {
        type: 'adjust_many',
        sourceKey: damageDraft.sourceKey,
        amount: -amount,
        scope: effectiveScope,
        mode: damageDraft.mode,
        drain: damageDraft.drain,
        drainAmount,
      });
    } else {
      enqueue({
        type: 'adjust',
        targetKey: damageDraft.targetKey,
        sourceKey: damageDraft.sourceKey,
        amount,
        mode: damageDraft.mode,
        drain: damageDraft.drain,
        drainAmount: damageDraft.drain ? amount : undefined,
      }, {
        type: 'adjust',
        targetKey: damageDraft.targetKey,
        sourceKey: damageDraft.sourceKey,
        amount: -amount,
        mode: damageDraft.mode,
        drain: damageDraft.drain,
        drainAmount: damageDraft.drain ? amount : undefined,
      });
    }
    setDamageDraft(null);
  };

  const openEnd = useCallback(() => {
    if (!record) return;
    const suggested = getSuggestedWinner(record.state);
    setWinnerKey(suggested?.participantKey ?? '');
    setIsDraw(false);
    setWinCondition(getDefaultWinCondition(record.state));
    setEndOpen(true);
  }, [record, setEndOpen, setIsDraw, setWinCondition, setWinnerKey]);

  useEffect(() => {
    if (!record) {
      previousActivePlayerCountRef.current = null;
      return;
    }

    const activePlayerCount = record.state.players.filter((player) => !player.isEliminated).length;
    const previousActivePlayerCount = previousActivePlayerCountRef.current;
    previousActivePlayerCountRef.current = activePlayerCount;

    if (previousActivePlayerCount !== null && previousActivePlayerCount > 1 && activePlayerCount === 1) {
      openEnd();
    }
  }, [openEnd, record]);

  const finishGame = async () => {
    if (!record) return;
    const result = {
      winnerKey: isDraw ? null : winnerKey || null,
      isDraw,
      winCondition: isDraw ? null : winCondition,
    };
    if (!isValidLiveGameResult(record.state, result)) {
      toast({ title: copy({ it: 'Seleziona vincitore e condizione di vittoria.', en: 'Select a winner and win condition.' }), variant: 'destructive' });
      return;
    }
    const job=beginLiveJob('command');
    if(!job)return;
    try{
    if (!isDraw && result.winCondition === 'last_standing' && result.winnerKey) {
      enqueue({ type: 'last_standing', winnerKey: result.winnerKey });
    }
    const finalRecord = recordRef.current ?? record;
    const players = finalRecord.state.players.map((player) => {
      const participant = participants.find((entry) => entry.key === player.participantKey)!;
      return {
        participantKey: player.participantKey,
        deckId: player.deckId,
        isGuest: participant.isGuest,
        userId: participant.userId,
        guestId: participant.guestId,
      };
    });
    pendingFinalizationRef.current = {
      winnerKey: result.winnerKey,
      isDraw,
      winCondition: result.winCondition,
      endedAt: new Date().toISOString(),
      players,
    };
    persist(finalRecord);
    setEnding(true);
    const saved = await flush();
    if(!job.active())return;
    if (saved) {
      toast({ title: copy({ it: `Partita salvata · ${duration}`, en: `Game saved · ${duration}` }) });
    } else {
      toast({ title: copy({ it: 'Salvataggio in attesa di connessione', en: 'Waiting for connection to save' }), variant: 'destructive' });
    }
    }finally{if(job.active())setEnding(false);job.finish();}
  };

  const cancelGame = async () => {
    if (!record) return;
    const job=beginLiveJob('command');
    if(!job)return;
    try{
    pendingCancelRef.current = true;
    persist(record);
    const cancelled = await flush();
    if (job.active()&&cancelled) {
      router.replace(`/table/${groupId}`);
    }
    }finally{job.finish();}
  };

  if (booting) {
    return <div className="grid min-h-dvh place-items-center bg-black text-emerald-200"><Loader2 className="h-9 w-9 animate-spin" /></div>;
  }

  if (!record) {
    if (completedRecord) {
      return <WebCompletedGame record={completedRecord} duration={completedDuration}
        arenaName={arenaName} journalError={recoveryIssue || localSaveError} starting={starting}
        onReselect={(previousSetup) => { restoreSetup(previousSetup); setCompletedRecord(null); }}
        onRematch={(previousSetup) => void startGame(previousSetup)}
        onBack={() => router.replace(`/table/${groupId}`)} />;
    }
    return <WebTrackerWizard setup={setup} groupId={groupId} arenaName={arenaName}
      online={online} journalError={recoveryIssue || localSaveError} starting={starting}
      deckWizardSearch={featureFlags?.deckWizardSearch !== false}
      onExit={() => router.push(`/table/${groupId}`)} onStart={() => void startGame()} />;
  }

  const orientation = getViewportTableOrientation(tableSize.width, tableSize.height);
  const layouts = getSquareTableLayouts(record.state.players.length, tableSize.width, tableSize.height, record.state.layoutVariant ?? 'classic', orientation);
  const assignments = mapPlayersToSeats(record.state.players, layouts, null);
  const centerToolbarBand = getCenterToolbarBand(
    record.state.players.length,
    tableSize.width,
    tableSize.height,
    record.state.layoutVariant ?? 'classic',
    orientation,
  );
  const panelPlayer = record.state.players.find((player) => player.participantKey === damagePanelKey);
  const activePlayers = record.state.players.filter((player) => !player.isEliminated);
  const alternativeRequired = activePlayers.length !== 1;
  const endGameWarnings = getLiveGameResultWarnings(record.state, {
    winnerKey: isDraw ? null : winnerKey || null,
    isDraw,
    winCondition: isDraw ? null : winCondition,
  });
  const toolbarMainSize = centerToolbarBand?.axis === 'vertical'
    ? centerToolbarBand.height
    : centerToolbarBand?.width ?? 0;
  const toolbarCrossSize = centerToolbarBand?.axis === 'vertical'
    ? centerToolbarBand.width
    : centerToolbarBand?.height ?? 0;
  const toolbarControlSize = Math.max(30, Math.min(56, toolbarCrossSize - 12, (toolbarMainSize - 96) / 8));
  const toolbarButtonStyle = { width: toolbarControlSize, height: toolbarControlSize };
  const toolbarDurationStyle = centerToolbarBand?.axis === 'vertical'
    ? { width: toolbarControlSize, height: Math.min(80, toolbarControlSize * 1.5) }
    : { width: Math.min(88, toolbarControlSize * 1.65), height: toolbarControlSize };

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black text-white touch-none">
      <WebJournalWarning error={recoveryIssue || localSaveError} className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-50 mx-auto max-w-xl" />
      <div ref={tableRef} className="absolute inset-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
        {assignments.map(({ player, layout }) => {
          const rotation = orientation === 'landscape'
            ? getLandscapeSeatRotation(layout, tableSize.width)
            : getSeatRotation(layout.role, record.state.players.length, record.state.layoutVariant ?? 'classic');
          const sideways = Math.abs(rotation) === 90;
          const selected = highlight === player.participantKey;
          const isStarting = record.state.startingPlayerKey === player.participantKey;
          const contentWidth = sideways ? layout.height : layout.width;
          const contentHeight = sideways ? layout.width : layout.height;
          const shortestSide = Math.min(contentWidth, contentHeight);
          const controlSize = Math.max(36, Math.min(68, shortestSide * 0.16));
          const controlWidth = controlSize * 1.35;
          const controlInset = Math.max(8, Math.min(24, contentWidth * 0.055));
          const iconSize = Math.max(18, Math.min(31, controlSize * 0.48));
          const auxiliarySize = Math.max(32, Math.min(48, controlSize * 0.75));
          return (
            <section key={player.participantKey} data-player-key={player.participantKey} onPointerDown={(event) => beginDamageDrag(event, player.participantKey)} onClickCapture={(event) => { if (randomOpponentMode) { event.stopPropagation(); selectRandomOpponent(player.participantKey); } }} className={cn('absolute overflow-hidden rounded-[clamp(12px,2vw,28px)] border-2 bg-zinc-950 transition-all duration-200', selected ? 'z-20 border-amber-300 shadow-[0_0_45px_rgba(251,191,36,.9)] brightness-125' : 'border-black/80', drag?.targetKey === player.participantKey && 'border-rose-400 shadow-[0_0_35px_rgba(244,63,94,.8)]', player.isEliminated && 'grayscale brightness-50')} style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height }}>
              <DeckImage src={player.commanderImage} alt={player.commander} className="absolute inset-0 h-full w-full rounded-none object-cover opacity-75" fallbackClassName="absolute inset-0 h-full w-full rounded-none" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/5 to-black/50" />
              <div className="absolute left-1/2 top-1/2" style={{ width: contentWidth, height: contentHeight, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}>
                <HoldActionButton variant="ghost" stopPropagation onShort={() => enqueue({ type: 'adjust', targetKey: player.participantKey, amount: 1, mode: 'life' }, { type: 'adjust', targetKey: player.participantKey, amount: -1, mode: 'life' })} onLong={() => enqueue({ type: 'adjust', targetKey: player.participantKey, amount: 10, mode: 'life' }, { type: 'adjust', targetKey: player.participantKey, amount: -10, mode: 'life' })} className="absolute top-1/2 z-10 grid -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/55 font-light shadow-lg backdrop-blur transition active:scale-90" style={{ left: controlInset, width: controlWidth, height: controlSize }} aria-label={`${copy({ it: 'Riduci punti vita di', en: 'Reduce life for' })} ${player.displayName}`}><Minus style={{ width: iconSize, height: iconSize }} /></HoldActionButton>
                <HoldActionButton variant="ghost" stopPropagation onShort={() => enqueue({ type: 'adjust', targetKey: player.participantKey, amount: -1, mode: 'life' }, { type: 'adjust', targetKey: player.participantKey, amount: 1, mode: 'life' })} onLong={() => enqueue({ type: 'adjust', targetKey: player.participantKey, amount: -10, mode: 'life' }, { type: 'adjust', targetKey: player.participantKey, amount: 10, mode: 'life' })} className="absolute top-1/2 z-10 grid -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/55 font-light shadow-lg backdrop-blur transition active:scale-90" style={{ right: controlInset, width: controlWidth, height: controlSize }} aria-label={`${copy({ it: 'Aumenta punti vita di', en: 'Increase life for' })} ${player.displayName}`}><Plus style={{ width: iconSize, height: iconSize }} /></HoldActionButton>
                <div className="pointer-events-none absolute left-1/2 top-[7%] z-10 max-w-[66%] -translate-x-1/2 truncate rounded-full border border-white/15 bg-gradient-to-r from-black/75 via-zinc-900/80 to-black/75 px-[clamp(10px,3%,20px)] py-[clamp(4px,1.5%,9px)] font-black tracking-wide text-white shadow-xl backdrop-blur-md" style={{ fontSize: `clamp(11px, ${shortestSide * 0.052}px, 22px)` }}>{player.displayName}</div>
                {(player.counters.monarch || player.counters.initiative || player.counters.energy > 0 || player.counters.experience > 0 || player.counters.commanderTax > 0) ? (
                  <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex max-w-24 flex-wrap-reverse justify-end gap-1.5" aria-label={[
                    player.counters.monarch ? copy({ it: 'Monarca', en: 'Monarch' }) : '',
                    player.counters.initiative ? copy({ it: 'Iniziativa', en: 'Initiative' }) : '',
                    player.counters.energy > 0 ? `${copy({ it: 'Energia', en: 'Energy' })} ${player.counters.energy}` : '',
                    player.counters.experience > 0 ? `${copy({ it: 'Esperienza', en: 'Experience' })} ${player.counters.experience}` : '',
                    player.counters.commanderTax > 0 ? `Commander Tax ${player.counters.commanderTax}` : '',
                  ].filter(Boolean).join(', ')}>
                    {player.counters.monarch ? <span title={copy({ it: 'Monarca', en: 'Monarch' })} className="grid h-9 w-9 place-items-center rounded-full border border-amber-200/70 bg-amber-950/90 text-amber-100 shadow-lg backdrop-blur"><Crown className="h-5 w-5" /></span> : null}
                    {player.counters.initiative ? <span title={copy({ it: 'Iniziativa', en: 'Initiative' })} className="grid h-9 w-9 place-items-center rounded-full border border-cyan-200/65 bg-cyan-950/90 text-cyan-100 shadow-lg backdrop-blur"><Swords className="h-5 w-5" /></span> : null}
                    {player.counters.energy > 0 ? <span title={copy({ it: 'Energia', en: 'Energy' })} className="grid h-9 min-w-9 place-items-center rounded-full border border-yellow-200/60 bg-yellow-950/90 px-2 text-xs font-black text-yellow-100">E {player.counters.energy}</span> : null}
                    {player.counters.experience > 0 ? <span title={copy({ it: 'Esperienza', en: 'Experience' })} className="grid h-9 min-w-9 place-items-center rounded-full border border-violet-200/60 bg-violet-950/90 px-2 text-xs font-black text-violet-100">XP {player.counters.experience}</span> : null}
                    {player.counters.commanderTax > 0 ? <span title="Commander Tax" className="grid h-9 min-w-9 place-items-center rounded-full border border-slate-200/60 bg-slate-950/90 px-2 text-xs font-black text-slate-100">T {player.counters.commanderTax}</span> : null}
                  </div>
                ) : null}
                <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
                  <LifeReadout life={player.life} className="font-black leading-none drop-shadow-[0_3px_4px_rgba(0,0,0,.9)]" style={{ fontSize: `clamp(54px, ${shortestSide * 0.28}px, 112px)` }} />
                </div>
                <button
                  onClick={(event) => { event.stopPropagation(); setDamagePanelKey(player.participantKey); }}
                  className="absolute left-1/2 top-3/4 z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-emerald-200/30 bg-black/65 text-emerald-100 shadow-lg backdrop-blur transition active:scale-90"
                  style={{ width: controlSize, height: controlSize }}
                  aria-label={`${player.displayName} damage details`}
                >
                  <Shield style={{ width: iconSize, height: iconSize }} />
                </button>
                {player.isEliminated && <button onClick={(event) => { event.stopPropagation(); enqueue({ type: 'revive', targetKey: player.participantKey, startingLife: record.starting_life }, { type: 'restore-player', player }); }} className="absolute left-3 top-3 z-20 rounded-full bg-emerald-600 px-3 font-black" style={{ height: auxiliarySize, fontSize: Math.max(10, auxiliarySize * 0.27) }}><RotateCcw className="mr-1 inline" style={{ width: auxiliarySize * 0.38, height: auxiliarySize * 0.38 }} />Revive</button>}
                {!player.isEliminated && <button aria-label={`${copy({ it: 'Elimina giocatore', en: 'Eliminate player' })} ${player.displayName}`} onClick={(event) => { event.stopPropagation(); setConfirmEliminate(player.participantKey); }} className="absolute left-3 top-3 z-20 grid place-items-center rounded-full border border-white/20 bg-black/55 text-white/75" style={{ width: auxiliarySize, height: auxiliarySize }}><Skull style={{ width: auxiliarySize * 0.4, height: auxiliarySize * 0.4 }} /></button>}
                {isStarting && (() => {
                  const clockwise = record.state.startingDirection === 'clockwise';
                  const DirectionIcon = clockwise ? RotateCw : RotateCcw;
                  const label = clockwise
                    ? copy({ it: 'Primo giocatore · senso orario', en: 'Starting player · clockwise' })
                    : copy({ it: 'Primo giocatore · senso antiorario', en: 'Starting player · counterclockwise' });
                  return <div role="img" aria-label={label} title={label} className="absolute bottom-3 left-3 grid h-9 w-9 place-items-center rounded-full border border-amber-300/60 bg-amber-950/90 text-amber-100 shadow-lg"><DirectionIcon className="h-7 w-7" /><span className="absolute text-[11px] font-black">1</span></div>;
                })()}
              </div>
            </section>
          );
        })}

        {centerToolbarBand && <div data-testid="live-center-toolbar"
          className={cn(
            'absolute z-30 flex items-center justify-center',
            centerToolbarBand.axis === 'vertical' ? 'flex-col' : 'flex-row',
          )}
          style={{
            left: centerToolbarBand.left,
            top: centerToolbarBand.top,
            width: centerToolbarBand.width,
            height: centerToolbarBand.height,
          }}
        >
        <div className={cn('flex h-full w-full items-center justify-between border border-white/10 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur-xl', centerToolbarBand.axis === 'vertical' ? 'flex-col' : 'flex-row')}>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" style={toolbarButtonStyle} onClick={() => setExitChoiceOpen(true)} title="Back"><ArrowLeft /></Button>
          <div className={cn('flex shrink-0 items-center justify-center gap-1 rounded-full bg-zinc-900 px-1.5 text-xs font-bold text-zinc-300', centerToolbarBand.axis === 'vertical' && 'flex-col px-1')} style={toolbarDurationStyle}><WebSyncBadge state={syncPresentationStatus} pendingOperations={pendingSyncCount} errorDetail={syncError} onRetry={() => void flush()} />{duration}</div>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" style={toolbarButtonStyle} onClick={undoLastMutation} disabled={!undoDepth} title="Undo"><RotateCcw /></Button>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" style={toolbarButtonStyle} onClick={redoLastMutation} disabled={!redoDepth} title="Redo"><Redo2 /></Button>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" style={toolbarButtonStyle} onClick={() => runRoulette(activePlayers.map((player) => player.participantKey))} title="Random player"><Dices /></Button>
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" style={toolbarButtonStyle} onClick={() => { setRandomizerResult(null); setRandomizerOpen(true); }} title="Dado o moneta"><Box /></Button>
          <Button variant={randomOpponentMode ? 'default' : 'ghost'} size="icon" className="shrink-0 rounded-full" style={toolbarButtonStyle} onClick={() => setRandomOpponentMode((value) => !value)} title="Random opponent">
            <span className="relative block h-5 w-5">
              <UserRound className="absolute left-0 top-0 h-[18px] w-[18px]" />
              <Dices className="absolute -bottom-1 -right-1 h-3 w-3 text-emerald-300" />
            </span>
          </Button>
          <Button data-testid="live-end" variant="ghost" size="icon" className="shrink-0 rounded-full" style={toolbarButtonStyle} onClick={openEnd} title="End game"><Flag /></Button>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full"
            style={toolbarButtonStyle}
            onClick={enterTrackerLandscape}
            title={copy({ it: 'Blocca in orizzontale', en: 'Lock landscape' })}
            aria-label={copy({ it: 'Blocca in orizzontale', en: 'Lock landscape' })}
          >
            <Maximize2 className={fullscreen ? 'text-emerald-300' : undefined} />
          </Button>
        </div>
        </div>}
        {randomOpponentMode && <div className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+1rem)] z-40 mx-auto max-w-md rounded-2xl border border-emerald-400/40 bg-emerald-950/95 px-4 py-3 text-center text-sm font-bold shadow-2xl backdrop-blur">{copy({ it: 'Tocca qualsiasi punto della card del giocatore attivo da escludere.', en: 'Tap anywhere on the active player card to exclude them.' })}</div>}
        {recoveredJournal ? <div className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+3.25rem)] z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-400/35 bg-zinc-950/95 px-3 py-2 text-xs text-amber-100 shadow-xl"><span>{copy({ it: 'Partita recuperata dal dispositivo', en: 'Game recovered from this device' })}</span>{pendingSyncCount > 0 ? <button type="button" onClick={() => void flush()} className="font-black text-emerald-300">{copy({ it: 'Sincronizza', en: 'Sync' })}</button> : null}<button type="button" aria-label="Close" onClick={() => setRecoveredJournal(false)}><X className="h-3.5 w-3.5" /></button></div> : null}
        {liveOnboardingOpen ? <div role="dialog" aria-label={copy({ it: 'Guida rapida live', en: 'Live quick guide' })} className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 w-[min(92vw,390px)] -translate-x-1/2 rounded-2xl border border-emerald-400/35 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-xl"><div className="flex items-start gap-3"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /><div className="min-w-0 flex-1"><p className="font-black text-emerald-100">{copy({ it: 'Tre gesti utili', en: 'Three useful gestures' })}</p><ul className="mt-2 space-y-1 text-xs text-zinc-300"><li>{copy({ it: 'Tieni premuto +/− per modificare di 10.', en: 'Hold +/− to change by 10.' })}</li><li>{copy({ it: 'Trascina da un giocatore a un altro per assegnare danno.', en: 'Drag between players to assign damage.' })}</li><li>{copy({ it: 'La bandierina conclude e salva la partita.', en: 'The flag ends and saves the game.' })}</li></ul></div><button type="button" aria-label={copy({ it: 'Chiudi guida', en: 'Close guide' })} onClick={() => { try { localStorage.setItem('live-onboarding-v1', 'done'); } catch { /* Optional preference. */ } setLiveOnboardingOpen(false); }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5"><X className="h-4 w-4" /></button></div></div> : null}
      </div>

      {drag && <svg className="pointer-events-none fixed inset-0 z-50 h-full w-full"><defs><marker id="damage-arrow" markerWidth="14" markerHeight="14" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#fb7185" /></marker><filter id="damage-glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs><path d={`M ${drag.startX} ${drag.startY} Q ${(drag.startX + drag.x) / 2} ${Math.min(drag.startY, drag.y) - 90} ${drag.x} ${drag.y}`} fill="none" stroke="#fb7185" strokeWidth="7" strokeLinecap="round" markerEnd="url(#damage-arrow)" filter="url(#damage-glow)" strokeDasharray="12 8"><animate attributeName="stroke-dashoffset" from="40" to="0" dur=".7s" repeatCount="indefinite" /></path></svg>}

      {randomizerOpen && <ModalOverlay><ModalCard><div className="space-y-5 p-5"><div className="flex items-center justify-between"><h2 className="text-xl font-black">{copy({ it: 'Dado o moneta', en: 'Die or coin' })}</h2><button onClick={() => setRandomizerOpen(false)} aria-label="Close"><X /></button></div><div className="grid grid-cols-4 gap-2">{([
        ['coin', copy({ it: 'Moneta', en: 'Coin' })],
        ['d4', 'd4'],
        ['d6', 'd6'],
        ['d20', 'd20'],
      ] as Array<[TableRandomKind, string]>).map(([kind, label]) => <button key={kind} onClick={() => setRandomizerResult(rollTableRandom(kind))} className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4 font-black transition active:scale-95">{label}</button>)}</div>{randomizerResult !== null ? <div className="rounded-3xl border border-emerald-400/20 bg-black/30 p-8 text-center text-7xl font-black text-emerald-200">{randomizerResult === 'heads' ? copy({ it: 'Testa', en: 'Heads' }) : randomizerResult === 'tails' ? copy({ it: 'Croce', en: 'Tails' }) : randomizerResult}</div> : null}</div></ModalCard></ModalOverlay>}

      {damageDraft && (() => {
        const source = record.state.players.find((player) => player.participantKey === damageDraft.sourceKey);
        const target = record.state.players.find((player) => player.participantKey === damageDraft.targetKey);
        const sourceAssignment = assignments.find(({ player }) => player.participantKey === damageDraft.sourceKey);
        const sourceRotation = sourceAssignment
          ? orientation === 'landscape'
            ? getLandscapeSeatRotation(sourceAssignment.layout, tableSize.width)
            : getSeatRotation(
              sourceAssignment.layout.role,
              record.state.players.length,
              record.state.layoutVariant ?? 'classic',
            )
          : 0;
        const amount = Math.max(0, Math.min(999, Number(damageAmount) || 0));
        const targetCount = damageDraft.scope === 'all_players'
          ? record.state.players.filter((player) => !player.isEliminated).length
          : damageDraft.scope === 'opponents'
            ? record.state.players.filter((player) => !player.isEliminated && player.participantKey !== damageDraft.sourceKey).length
            : 1;
        const scopeLabel = damageDraft.scope === 'opponents'
          ? copy({ it: 'ogni avversario', en: 'each opponent' })
          : damageDraft.scope === 'all_players'
            ? copy({ it: 'tutti i giocatori', en: 'all players' })
            : target?.displayName || '';
        const modeLabel = damageDraft.mode === 'life'
          ? copy({ it: 'danno', en: 'damage' })
          : damageDraft.mode === 'commander' ? copy({ it: 'danno commander', en: 'commander damage' }) : 'infect';
        return <ModalOverlay className="bg-black/90"><ModalCard size="lg" className="relative overflow-hidden border-rose-400/25 bg-zinc-950">
          {target?.commanderImage ? <DeckImage src={target.commanderImage} alt={target.commander} className="pointer-events-none absolute inset-0 h-full w-full object-cover object-top opacity-20" /> : null}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-zinc-950/95 via-rose-950/65 to-zinc-950/95" />
          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <LiveGameModalTitle icon={Swords} title={copy({ it: 'Assegna danno', en: 'Assign damage' })} onClose={() => setDamageDraft(null)} />
          <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
          <p className="truncate text-center text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">{source?.displayName} <span className="px-2 text-rose-300">→</span> {target?.displayName}</p>
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-black/35 p-1">{(['life', 'commander', 'infect'] as DamageMode[]).map((mode) => <button key={mode} onClick={() => setDamageDraft({ ...damageDraft, mode, scope: mode === 'commander' ? 'single' : damageDraft.scope })} className={cn('min-h-11 rounded-xl px-2 text-xs font-black uppercase tracking-wide transition', damageDraft.mode === mode ? 'bg-emerald-500 text-white shadow-lg' : 'text-zinc-400 hover:bg-white/5')}>{mode === 'life' ? copy({ it: 'Normale', en: 'Normal' }) : mode === 'commander' ? 'Commander' : 'Infect'}</button>)}</div>
          {damageDraft.mode !== 'commander' ? <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-black/25 p-1">{([
            ['single', copy({ it: 'Questo giocatore', en: 'This player' })],
            ['opponents', copy({ it: 'Ogni avversario', en: 'Each opponent' })],
            ['all_players', copy({ it: 'Tutti', en: 'Everyone' })],
          ] as const).map(([scope, label]) => <button key={scope} onClick={() => setDamageDraft({ ...damageDraft, scope, drain: scope === 'all_players' ? false : damageDraft.drain })} className={cn('min-h-11 rounded-xl px-2 py-2 text-[11px] font-bold transition', damageDraft.scope === scope ? 'bg-rose-500/25 text-rose-100 ring-1 ring-rose-400/70' : 'text-zinc-400 hover:bg-white/5')}>{label}</button>)}</div> : null}
          {damageDraft.mode !== 'infect' ? <button type="button" onClick={() => setDamageDraft({ ...damageDraft, drain: !damageDraft.drain, scope: !damageDraft.drain && damageDraft.scope === 'all_players' ? 'opponents' : damageDraft.scope })} className={cn('flex min-h-11 w-full items-center gap-3 rounded-2xl border px-4 text-left transition', damageDraft.drain ? 'border-teal-400/60 bg-teal-500/20 text-teal-100' : 'border-white/10 bg-black/25 text-zinc-400')}><Heart className="h-5 w-5" /><span className="flex-1"><b className="block text-sm">{damageDraft.mode === 'commander' ? 'Lifelink' : copy({ it: 'Drain', en: 'Drain' })}</b><small>{damageDraft.mode === 'commander' ? copy({ it: 'Guadagni vite pari al danno commander inflitto.', en: 'Gain life equal to the commander damage dealt.' }) : copy({ it: 'Guadagni vite pari al danno alle vite inflitto.', en: 'Gain life equal to the life damage dealt.' })}</small></span>{damageDraft.drain ? <Check className="h-5 w-5" /> : null}</button> : null}
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl border border-rose-400/30 bg-black/35">
            <div
              className="absolute inset-0 flex items-center justify-between px-5 sm:px-8"
              style={{ transform: `rotate(${sourceRotation}deg)` }}
            >
              <button type="button" onClick={() => setDamageAmount(String(Math.max(0, amount - 1)))} className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-white/25 bg-black/40 text-3xl font-light transition active:scale-90" aria-label={copy({ it: 'Riduci danno', en: 'Reduce damage' })}>−</button>
              <div className="min-w-0 flex-1 text-center"><input aria-label={copy({ it: 'Quantità danno', en: 'Damage amount' })} value={damageAmount} onChange={(event) => setDamageAmount(event.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className="h-24 w-full bg-transparent text-center text-7xl font-black leading-none tabular-nums text-white outline-none" /><p className="truncate text-sm font-black uppercase tracking-wide text-zinc-100">{modeLabel} · {scopeLabel}</p></div>
              <button type="button" onClick={() => setDamageAmount(String(Math.min(999, amount + 1)))} className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-white/25 bg-black/40 text-3xl font-light transition active:scale-90" aria-label={copy({ it: 'Aumenta danno', en: 'Increase damage' })}>+</button>
            </div>
          </div>
          <div className="grid grid-cols-6 gap-2">{[1, 2, 3, 5, 10, 15].map((quickAmount) => <button key={quickAmount} onClick={() => setDamageAmount(String(quickAmount))} className={cn('h-10 rounded-xl border text-sm font-black transition', damageAmount === String(quickAmount) ? 'border-rose-400 bg-rose-500/25 text-white' : 'border-white/10 bg-black/25 text-zinc-400')}>+{quickAmount}</button>)}</div>
          <div className="grid grid-cols-2 gap-3 pt-1"><Button variant="outline" onClick={() => setDamageDraft(null)} className="h-12 border-white/20 bg-black/20 font-black">{copy({ it: 'Annulla', en: 'Cancel' })}</Button><Button onClick={applyDamageDraft} disabled={amount === 0} className="h-12 bg-gradient-to-r from-rose-600 to-orange-600 font-black disabled:opacity-40">{damageDraft.scope === 'single' ? copy({ it: 'Risolvi', en: 'Resolve' }) : `${copy({ it: 'Risolvi', en: 'Resolve' })} ${amount} × ${targetCount}`}</Button></div>
        </div></div></ModalCard></ModalOverlay>;
      })()}

      {panelPlayer && (
        <ModalOverlay>
          <ModalCard size="lg">
            <LiveGameModalTitle
              icon={Shield}
              title={`${panelPlayer.displayName} · ${copy({ it: 'Dettaglio danni', en: 'Damage details' })}`}
              onClose={() => setDamagePanelKey(null)}
            />
            <div className="space-y-3 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3">
                {([
                  ['monarch', copy({ it: 'Monarca', en: 'Monarch' }), Crown],
                  ['initiative', copy({ it: 'Iniziativa', en: 'Initiative' }), Swords],
                ] as const).map(([emblem, label, Icon]) => <button
                  key={emblem}
                  onClick={() => {
                    const holderKey = record.state.players.find((entry) => entry.counters[emblem])?.participantKey ?? null;
                    enqueue(
                      { type: 'set_emblem', targetKey: panelPlayer.participantKey, emblem, active: !panelPlayer.counters[emblem] },
                      { type: 'restore_emblem', emblem, holderKey },
                    );
                  }}
                  className={cn('rounded-2xl border p-4 text-left transition', panelPlayer.counters[emblem] ? 'border-amber-300/70 bg-amber-500/20 text-amber-100' : 'border-border bg-background/60')}
                ><Icon className="mb-3 h-5 w-5" /><b>{label}</b></button>)}
              </div>
              {([
                ['energy', copy({ it: 'Energia', en: 'Energy' }), Sparkles],
                ['experience', copy({ it: 'Esperienza', en: 'Experience' }), Trophy],
                ['commanderTax', 'Commander Tax', Shield],
              ] as const).map(([counter, label, Icon]) => <div key={counter} className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 p-3"><Icon className="h-5 w-5 text-emerald-300" /><b className="flex-1">{label}</b><Button variant="outline" size="icon" onClick={() => enqueue({ type: 'adjust_counter', targetKey: panelPlayer.participantKey, counter, amount: -1 }, { type: 'adjust_counter', targetKey: panelPlayer.participantKey, counter, amount: 1 })}><Minus /></Button><strong className="w-8 text-center text-xl">{panelPlayer.counters[counter]}</strong><Button variant="outline" size="icon" onClick={() => enqueue({ type: 'adjust_counter', targetKey: panelPlayer.participantKey, counter, amount: 1 }, { type: 'adjust_counter', targetKey: panelPlayer.participantKey, counter, amount: -1 })}><Plus /></Button></div>)}
              <div className="flex items-center justify-between rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-3">
                <div>
                  <p className="font-black text-emerald-100">Infect</p>
                  <p className="text-xs text-muted-foreground">{panelPlayer.infect} / 10</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => enqueue(
                      { type: 'adjust', targetKey: panelPlayer.participantKey, amount: -1, mode: 'infect' },
                      { type: 'adjust', targetKey: panelPlayer.participantKey, amount: 1, mode: 'infect' },
                    )}
                  >
                    <Minus />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => enqueue(
                      { type: 'adjust', targetKey: panelPlayer.participantKey, amount: 1, mode: 'infect' },
                      { type: 'adjust', targetKey: panelPlayer.participantKey, amount: -1, mode: 'infect' },
                    )}
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
              {Object.entries(panelPlayer.commanderDamageFrom).map(([sourceKey, amount]) => {
                const source = record.state.players.find((entry) => entry.participantKey === sourceKey)!;
                const adjustment = {
                  targetKey: panelPlayer.participantKey,
                  sourceKey: source.participantKey,
                  mode: 'commander' as const,
                };
                return (
                  <div key={sourceKey} className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 p-3">
                    <DeckImage src={source.commanderImage} alt={source.commander} className="h-14 w-11 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-black">{source.displayName}</p>
                      <p className="text-xs text-muted-foreground">{source.commander}</p>
                    </div>
                    <b className="text-2xl">{amount}</b>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => enqueue(
                          { type: 'adjust', ...adjustment, amount: -1 },
                          { type: 'adjust', ...adjustment, amount: 1 },
                        )}
                      >
                        <Minus />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => enqueue(
                          { type: 'adjust', ...adjustment, amount: 1 },
                          { type: 'adjust', ...adjustment, amount: -1 },
                        )}
                      >
                        <Plus />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ModalCard>
        </ModalOverlay>
      )}

      {endOpen && <ModalOverlay onClose={() => setEndOpen(false)}><ModalCard size="lg"><LiveGameModalTitle icon={Trophy} title={copy({ it: 'Concludi partita', en: 'End game' })} onClose={() => setEndOpen(false)} /><div className="space-y-5 overflow-y-auto p-5"><div className="flex items-center justify-between rounded-2xl border border-border bg-background/60 p-3"><span className="font-bold">{copy({ it: 'Pareggio', en: 'Draw' })}</span><button onClick={() => { setIsDraw((value) => !value); setWinnerKey(''); setWinCondition(null); }} className={cn('h-7 w-12 rounded-full p-1 transition', isDraw ? 'bg-emerald-600' : 'bg-zinc-700')}><span className={cn('block h-5 w-5 rounded-full bg-white transition', isDraw && 'translate-x-5')} /></button></div>{!isDraw && <><div className="grid gap-2 sm:grid-cols-2">{activePlayers.map((player) => <button data-testid="live-winner" key={player.participantKey} onClick={() => { setWinnerKey(player.participantKey); setWinCondition(activePlayers.length === 1 ? 'last_standing' : null); }} className={cn('flex items-center gap-3 rounded-2xl border p-3 text-left transition', winnerKey === player.participantKey ? 'border-emerald-400 bg-emerald-500/20' : 'border-border bg-background/60')}><DeckImage src={player.commanderImage} alt={player.commander} className="h-12 w-10 rounded-lg object-cover" /><span className="min-w-0 flex-1"><b className="block truncate">{player.displayName}</b><small className="block truncate text-muted-foreground">{player.commander}</small></span>{winnerKey === player.participantKey && <Check className="text-emerald-300" />}</button>)}</div>{winnerKey && (alternativeRequired ? <div className="grid grid-cols-2 gap-2">{WIN_CONDITIONS.filter((condition) => condition.value !== 'last_standing' || featureFlags?.lastStanding !== false).map((condition) => { const Icon = condition.icon; return <button data-testid={`live-win-${condition.value}`} key={condition.value} onClick={() => setWinCondition(condition.value)} className={cn('rounded-2xl border p-4 text-left', winCondition === condition.value ? 'border-emerald-400 bg-emerald-500/20' : 'border-border bg-background/60')}><Icon className="mb-2 h-5 w-5 text-emerald-300" /><b className="text-sm">{copy(condition.label)}</b></button>; })}</div> : <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/25 p-4 font-bold text-emerald-200"><Shield /><span className="flex-1">{copy({ it: 'Ultimo giocatore rimasto', en: 'Last player standing' })}</span><Check /></div>)}</>}{endGameWarnings.length > 0 ? <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 p-3 text-sm text-amber-200">{copy({ it: 'Verifica il risultato: il vincitore ha un valore letale/risulta eliminato oppure è rimasto un solo giocatore nel pareggio.', en: 'Verify the result: the winner has a lethal total/is eliminated, or only one player remains in a draw.' })}</div> : null}<div className="flex gap-3"><Button variant="outline" onClick={() => setEndOpen(false)} className="flex-1">{copy({ it: 'Annulla', en: 'Cancel' })}</Button><Button data-testid="live-save" onClick={finishGame} disabled={ending || (!isDraw && (!winnerKey || !winCondition))} className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 font-black">{ending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{copy({ it: 'Salva partita', en: 'Save game' })}</Button></div></div></ModalCard></ModalOverlay>}

      {confirmEliminate && <ModalOverlay><ModalCard><LiveGameModalTitle icon={Skull} title={copy({ it: 'Eliminare il giocatore?', en: 'Eliminate player?' })} onClose={() => setConfirmEliminate(null)} /><div className="space-y-4 p-5"><p className="text-muted-foreground">{record.state.players.find((player) => player.participantKey === confirmEliminate)?.displayName}</p><div className="flex gap-3"><Button variant="outline" onClick={() => setConfirmEliminate(null)} className="flex-1">{copy({ it: 'Annulla', en: 'Cancel' })}</Button><Button variant="destructive" onClick={() => { const player = record.state.players.find((entry) => entry.participantKey === confirmEliminate); enqueue({ type: 'eliminate', targetKey: confirmEliminate, eliminatedAt: new Date().toISOString() }, player ? { type: 'restore-player', player } : undefined); setConfirmEliminate(null); }} className="flex-1">{copy({ it: 'Elimina', en: 'Eliminate' })}</Button></div></div></ModalCard></ModalOverlay>}

      {exitChoiceOpen && <ModalOverlay><ModalCard><LiveGameModalTitle icon={null} title={copy({ it: 'Uscire dal tracker?', en: 'Leave the tracker?' })} onClose={() => setExitChoiceOpen(false)} /><div className="space-y-3 p-5"><p className="pb-1 text-sm text-muted-foreground">{copy({ it: 'La partita resta al sicuro finché non scegli di annullarla.', en: 'Your game stays safe unless you explicitly cancel it.' })}</p><button onClick={() => router.push(`/table/${groupId}`)} className="flex w-full items-center gap-3 rounded-2xl border border-emerald-400/35 bg-emerald-500/10 p-3 text-left transition hover:bg-emerald-500/15 active:scale-[.99]"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-500/20 text-emerald-200"><Pause className="h-5 w-5" /></span><span className="min-w-0 flex-1"><b className="block">{copy({ it: 'Pausa partita', en: 'Pause game' })}</b><small className="text-muted-foreground">{copy({ it: 'Torna all’arena e riprendi quando vuoi.', en: 'Return to the arena and resume whenever you want.' })}</small></span><ChevronRight className="h-5 w-5 text-muted-foreground" /></button><button onClick={() => { setExitChoiceOpen(false); setConfirmCancel(true); }} className="flex w-full items-center gap-3 rounded-2xl border border-red-400/30 bg-red-950/20 p-3 text-left transition hover:bg-red-950/30 active:scale-[.99]"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-950/50 text-red-300"><Trash2 className="h-5 w-5" /></span><span className="min-w-0 flex-1"><b className="block text-red-200">{copy({ it: 'Annulla partita', en: 'Cancel game' })}</b><small className="text-muted-foreground">{copy({ it: 'Elimina la sessione senza salvare un risultato.', en: 'Discard the session without saving a result.' })}</small></span><ChevronRight className="h-5 w-5 text-red-300/70" /></button></div></ModalCard></ModalOverlay>}

      {confirmCancel && <ModalOverlay><ModalCard><LiveGameModalTitle icon={Flag} title={copy({ it: 'Annullare la partita?', en: 'Cancel this game?' })} onClose={() => setConfirmCancel(false)} /><div className="space-y-4 p-5"><p className="text-sm text-muted-foreground">{copy({ it: 'La partita live verrà eliminata senza creare un record.', en: 'The live game will be discarded without creating a record.' })}</p><div className="flex gap-3"><Button variant="outline" onClick={() => setConfirmCancel(false)} className="flex-1">{copy({ it: 'Continua a giocare', en: 'Keep playing' })}</Button><Button variant="destructive" onClick={cancelGame} className="flex-1">{copy({ it: 'Annulla partita', en: 'Cancel game' })}</Button></div></div></ModalCard></ModalOverlay>}
    </div>
  );
}
