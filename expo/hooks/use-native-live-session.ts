import { useLanguage } from '@/contexts/language-context';
import { useToast } from '@/contexts/toast-context';
import { apiPost } from '@/lib/api';
import { hapticLight } from '@/lib/haptics';
import type { LiveGameMutation, LiveGameRecord } from '@/lib/live-game';
import { withLiveGameTimeout } from '@/lib/live-game-async';
import { loadLiveGameOutbox, saveLiveGameOutbox, type ArchivedLiveGameOperation } from '@/lib/live-game-offline';
import { replayLiveGameOutbox } from '@/lib/live-game-outbox-replay';
import { applyQueuedLiveGameMutations, cancelLiveGame, ensureLiveGameCreated, fetchActiveLiveGame, subscribeToLiveGame } from '@/lib/live-game-service';
import { LIVE_GAME_SYNC_BATCH_SIZE, getLiveGameSyncDelay } from '@/lib/live-game-sync-policy';
import { countLiveGamePendingOperations, isLiveGameAuthenticationError } from '@/lib/live-game-sync-presentation';
import { persistLiveGameTelemetry, recordLiveGameSyncError } from '@/lib/live-game-telemetry';
import { toUserParticipantKey } from '@/lib/participant-keys';
import { supabase } from '@/lib/supabase';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { useLiveGameCommandScope } from './use-live-game-command-scope';
import { useNativeLiveConnectivity } from './use-native-live-connectivity';
import { useNativeLiveJournal } from './use-native-live-journal';
type Ports = {
    groupId: string | undefined;
    currentUserId: string | undefined;
    hasCompletedGame: boolean;
    scope: Pick<ReturnType<typeof useLiveGameCommandScope>, 'epoch' | 'isCurrent' | 'bindClient'>;
    setSetupRetry: Dispatch<SetStateAction<number>>;
    onRemoteCompleted: (record: LiveGameRecord) => void;
};
/** Owns one opening's journal, bootstrap, synchronization and network lifecycle. */
export function useNativeLiveSession({ groupId, currentUserId, scope, hasCompletedGame, setSetupRetry, onRemoteCompleted }: Ports) {
    const { epoch: liveScopeEpoch, isCurrent: isLiveScopeCurrent, bindClient: bindLiveClient } = scope;
    const { copy } = useLanguage();
    const { showToast } = useToast();
    const router = useRouter();
    const { journal, snapshot: journalSnapshot } = useNativeLiveJournal(groupId, currentUserId, { epoch: liveScopeEpoch, isCurrent: isLiveScopeCurrent });
    const liveGame = journalSnapshot.record;
    const realtimeRecordId = journalSnapshot.needsCreate ? undefined : liveGame?.id;
    const undoDepth = journalSnapshot.history.undo.length;
    const redoDepth = journalSnapshot.history.redo.length;
    const pendingSyncCount = journal.pendingCount();
    const localPersistenceAvailable = journalSnapshot.localPersistenceAvailable;
    const [booting, setBooting] = useState(true);
    const [recoveryOutbox, setRecoveryOutbox] = useState<ArchivedLiveGameOperation[]>([]);
    const bootstrappingRef = useRef(true);
    const syncRunningRef = useRef(false);
    const syncPromiseRef = useRef<Promise<void> | null>(null);
    const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [syncStatus, setSyncStatus] = useState<'offline' | 'pending' | 'syncing' | 'synced' | 'error'>('synced');
    const [syncError, setSyncError] = useState<string | null>(null);
    const [authenticationRequired, setAuthenticationRequired] = useState(false);
    const telemetrySessionRef = useRef(Crypto.randomUUID());
    useLayoutEffect(() => journal.view.subscribe((value, previous) => {
        if (value.record?.id !== previous.record?.id) {
            syncPromiseRef.current = null;
            syncRunningRef.current = false;
        }
    }), [journal]);
    useLayoutEffect(() => {
        bootstrappingRef.current = true;
        syncPromiseRef.current = null;
        syncRunningRef.current = false;
        if (syncTimerRef.current)
            clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
        setBooting(true);
        setRecoveryOutbox([]);
    }, [liveScopeEpoch]);
    const saveJournal = journal.persist;
    const flushOutbox = useCallback(async () => {
        if (!isLiveScopeCurrent())
            return;
        const bound = bindLiveClient();
        await replayLiveGameOutbox(bound.client, currentUserId ?? '', setRecoveryOutbox, isLiveScopeCurrent, matchId => {
            void apiPost('/api/notifications/match-completed', { matchId }, {
                authenticated: false, headers: { Authorization: `Bearer ${bound.accessToken}` },
            });
        });
    }, [bindLiveClient, currentUserId, isLiveScopeCurrent, setRecoveryOutbox]);
    useEffect(() => {
        let active = true;
        void loadLiveGameOutbox(currentUserId).then(outbox => {
            if (active && isLiveScopeCurrent())
                setRecoveryOutbox(outbox);
        }).catch(() => {
            if (active && isLiveScopeCurrent()) {
                journal.markUnavailable();
                setSyncError('LIVE_GAME_OUTBOX_UNAVAILABLE');
            }
        });
        return () => { active = false; };
    }, [journal, currentUserId, isLiveScopeCurrent]);
    const syncJournal = useCallback(() => {
        // Bootstrap owns journal/outbox replacement; reconnect must not sync the
        // old session concurrently while its operations are being archived.
        if (bootstrappingRef.current || !isLiveScopeCurrent())
            return Promise.resolve();
        const gameId = journal.getSnapshot().record?.id ?? null;
        const active = () => isLiveScopeCurrent() && (journal.getSnapshot().record?.id ?? null) === gameId;
        if (syncTimerRef.current) {
            clearTimeout(syncTimerRef.current);
            syncTimerRef.current = null;
        }
        if (syncPromiseRef.current)
            return syncPromiseRef.current;
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
                if (!active() || journal.getSnapshot().closed)
                    return;
                let serverRecord = journal.getSnapshot().serverRecord;
                if (!serverRecord)
                    return;
                if (journal.getSnapshot().needsCreate) {
                    serverRecord = await ensureLiveGameCreated(commandClient, serverRecord);
                    if (!active() || journal.getSnapshot().closed)
                        return;
                    if (!journal.acceptCreated(serverRecord))
                        return;
                    await saveJournal();
                }
                while (active() && journal.getSnapshot().mutations.length > 0) {
                    const batch = journal.getSnapshot().mutations.slice(0, LIVE_GAME_SYNC_BATCH_SIZE);
                    serverRecord = await applyQueuedLiveGameMutations(commandClient, serverRecord, batch);
                    if (!active() || journal.getSnapshot().closed)
                        return;
                    if (!journal.acknowledgeBatch(serverRecord, batch))
                        return;
                    await saveJournal();
                }
                if (active() && journal.getSnapshot().pendingCancel) {
                    await cancelLiveGame(commandClient, serverRecord.id);
                    if (!active())
                        return;
                    await journal.acknowledgeCancellation(serverRecord.id);
                }
            }
            catch (error) {
                if (!active())
                    return;
                failed = true;
                setAuthenticationRequired(isLiveGameAuthenticationError(error));
                const message = getSupabaseErrorMessage(error, 'Sync failed');
                setSyncError(message);
                recordLiveGameSyncError(new Error(message));
                setSyncStatus('error');
                // Offline, timeout or a transient Realtime gap: the durable journal retries later.
            }
            finally {
                if (active()) {
                    syncRunningRef.current = false;
                    if (!failed) {
                        setAuthenticationRequired(false);
                        setSyncStatus(journal.getSnapshot().mutations.length ? 'pending' : 'synced');
                    }
                    if (currentUserId && commandClient) {
                        void persistLiveGameTelemetry(commandClient, {
                            userId: currentUserId,
                            liveGameId: journal.getSnapshot().record?.id ?? null,
                            sessionId: telemetrySessionRef.current,
                            platform: 'expo',
                            force: failed,
                        }).catch(() => undefined);
                    }
                }
            }
        })().finally(() => {
            if (syncPromiseRef.current === tracked)
                syncPromiseRef.current = null;
        });
        syncPromiseRef.current = tracked;
        return tracked;
    }, [journal, bindLiveClient, currentUserId, flushOutbox, isLiveScopeCurrent, saveJournal, setSyncStatus, setSyncError, setAuthenticationRequired]);
    const flushArchivedOutbox = useCallback(() => {
        const pendingSync = syncPromiseRef.current;
        void (pendingSync ?? Promise.resolve())
            .catch(() => undefined)
            .finally(() => {
            void syncJournal();
        });
    }, [syncJournal]);
    const scheduleSync = useCallback(() => {
        if (syncTimerRef.current)
            clearTimeout(syncTimerRef.current);
        if (!isLiveScopeCurrent() || journal.getSnapshot().closed || journal.getSnapshot().mutations.length === 0) {
            syncTimerRef.current = null;
            return;
        }
        const delay = getLiveGameSyncDelay({
            queueDepth: journal.getSnapshot().mutations.length,
            batchStartedAt: journal.getSnapshot().batchStartedAt,
        });
        syncTimerRef.current = setTimeout(() => {
            syncTimerRef.current = null;
            void syncJournal();
        }, delay);
    }, [journal, isLiveScopeCurrent, syncJournal]);
    useEffect(() => {
        if (!groupId || !currentUserId)
            return;
        bootstrappingRef.current = true;
        let mounted = true;
        void (async () => {
            let cached = await withLiveGameTimeout(journal.loadSaved(), 3000).catch(() => null);
            if (!mounted || !isLiveScopeCurrent())
                return;
            const participantKey = toUserParticipantKey(currentUserId);
            if (cached) {
                if (!journal.restore(cached)) {
                    journal.markUnavailable();
                    cached = null;
                }
                else
                    setSyncStatus(cached.mutations.length ? 'pending' : 'synced');
            }
            try {
                const remote = await withLiveGameTimeout(fetchActiveLiveGame(bindLiveClient().client, groupId, participantKey));
                if (!mounted || !isLiveScopeCurrent())
                    return;
                if (remote && (!cached || !cached.needsCreate || remote.id === cached.record.id)) {
                    if (!await journal.replaceRemote(remote))
                        return;
                    if (!mounted || !isLiveScopeCurrent())
                        return;
                    await saveJournal();
                }
                else if (!remote && cached && !cached.needsCreate) {
                    if (!await journal.forgetClean()) {
                        setSyncStatus('error');
                        return;
                    }
                    if (!mounted || !isLiveScopeCurrent())
                        return;
                }
                else if (!remote && !cached) {
                    await journal.forgetClean();
                }
            }
            catch {
                // Cached session remains fully playable while offline.
            }
            finally {
                if (mounted && isLiveScopeCurrent()) {
                    bootstrappingRef.current = false;
                    setBooting(false);
                    void syncJournal();
                }
            }
        })();
        return () => { mounted = false; };
    }, [journal, bindLiveClient, currentUserId, groupId, isLiveScopeCurrent, saveJournal, syncJournal]);
    const refreshAuthoritativeState = useCallback(async () => {
        const current = journal.getSnapshot().record;
        if (!isLiveScopeCurrent() || !groupId || !currentUserId || !current || journal.getSnapshot().needsCreate || syncRunningRef.current)
            return;
        const remote = await fetchActiveLiveGame(bindLiveClient().client, groupId, toUserParticipantKey(currentUserId));
        if (!isLiveScopeCurrent() || !remote || remote.id !== current.id || journal.getSnapshot().closed || journal.getSnapshot().record?.id !== current.id)
            return;
        journal.applyRemote(remote);
        await saveJournal();
    }, [journal, bindLiveClient, currentUserId, groupId, isLiveScopeCurrent, saveJournal]);
    const resumeRemoteGame = useCallback(async () => {
        if (!isLiveScopeCurrent() || bootstrappingRef.current || !groupId || !currentUserId || journal.getSnapshot().record)
            return;
        // Never resurrect a game that is being finalized or discarded, or one
        // that already produced a recap: the server may still report it active
        // until the queued terminal operation is flushed.
        if (journal.getSnapshot().closed || journal.getSnapshot().pendingFinalization || journal.getSnapshot().pendingCancel || hasCompletedGame)
            return;
        const remote = await withLiveGameTimeout(fetchActiveLiveGame(bindLiveClient().client, groupId, toUserParticipantKey(currentUserId)));
        if (!isLiveScopeCurrent() || !remote || journal.getSnapshot().record || journal.getSnapshot().closed || hasCompletedGame)
            return;
        if (!await journal.replaceRemote(remote))
            return;
        setSyncStatus('synced');
        await saveJournal();
        if (isLiveScopeCurrent())
            void syncJournal();
    }, [journal, bindLiveClient, hasCompletedGame, currentUserId, groupId, isLiveScopeCurrent, saveJournal, syncJournal, setSyncStatus]);
    useEffect(() => {
        if (booting || liveGame || hasCompletedGame)
            return undefined;
        const timer = setTimeout(() => {
            void resumeRemoteGame().catch(() => undefined);
        }, 1500);
        return () => clearTimeout(timer);
    }, [booting, hasCompletedGame, liveGame, resumeRemoteGame]);
    useEffect(() => {
        if (!realtimeRecordId)
            return undefined;
        let active = true;
        const stop = subscribeToLiveGame(supabase, realtimeRecordId, (remote) => {
            if (!active || !isLiveScopeCurrent() || journal.getSnapshot().closed)
                return;
            // A channel removal is asynchronous: ignore an event delivered for a
            // previous game after the local session already moved on.
            if (journal.getSnapshot().record?.id !== realtimeRecordId)
                return;
            if (remote.status !== 'active') {
                if (journal.getSnapshot().pendingFinalization || journal.getSnapshot().pendingCancel)
                    return;
                void journal.closeRemote().then(closed => {
                    if (!isLiveScopeCurrent())
                        return;
                    if (!closed) {
                        if (active)
                            setSyncStatus('error');
                        return;
                    }
                    // Closing clears the record and can tear down this channel before
                    // the promise continuation. The terminal ACK belongs to the journal
                    // opening; publish only while it is still closed and has no new round.
                    if (!journal.getSnapshot().closed || journal.getSnapshot().record)
                        return;
                    if (remote.status === 'ended') {
                        onRemoteCompleted(remote);
                        showToast(copy('liveGameSaved'));
                    }
                    else {
                        router.replace(`/table/${groupId}`);
                    }
                }).catch(() => { if (active && isLiveScopeCurrent()) {
                    journal.markUnavailable();
                    setSyncStatus('error');
                } });
                return;
            }
            if (syncRunningRef.current)
                return;
            journal.applyRemote(remote);
            void saveJournal();
        }, (status) => {
            if (!active || !isLiveScopeCurrent())
                return;
            if (status === 'SUBSCRIBED') {
                setSyncStatus(journal.getSnapshot().mutations.length ? 'pending' : 'synced');
                void refreshAuthoritativeState().catch(() => undefined).finally(() => { if (active && isLiveScopeCurrent())
                    void syncJournal(); });
            }
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                setSyncStatus('offline');
            }
        });
        return () => { active = false; stop(); };
    }, [onRemoteCompleted, journal, copy, currentUserId, groupId, isLiveScopeCurrent, realtimeRecordId, refreshAuthoritativeState, router, saveJournal, showToast, syncJournal]);
    const { networkOnline } = useNativeLiveConnectivity({ currentUserId, syncJournal, resumeRemoteGame,
        refreshAuthoritativeState, setSetupRetry, setSyncStatus,
        scope: { epoch: liveScopeEpoch, isCurrent: isLiveScopeCurrent, bindClient: bindLiveClient },
        getLiveGameId: () => journal.getSnapshot().record?.id ?? null, getTelemetrySessionId: () => telemetrySessionRef.current,
        cancelScheduledSync: () => { if (syncTimerRef.current)
            clearTimeout(syncTimerRef.current); syncTimerRef.current = null; } });
    const enqueueMutation = useCallback((mutation: LiveGameMutation, inverse?: LiveGameMutation, historyMode: 'record' | 'skip' = 'record') => {
        const written = journal.enqueue(mutation, inverse, historyMode);
        if (!written)
            return;
        setSyncStatus('pending');
        void written.then(scheduleSync, scheduleSync);
    }, [journal, scheduleSync, setSyncStatus]);
    const handleUndo = () => { const written = journal.undo(); if (written) {
        setSyncStatus('pending');
        void written.then(scheduleSync, scheduleSync);
        void hapticLight();
    } };
    const handleRedo = () => { const written = journal.redo(); if (written) {
        setSyncStatus('pending');
        void written.then(scheduleSync, scheduleSync);
        void hapticLight();
    } };
    const cancelScheduledSync = useCallback(() => { if (syncTimerRef.current)
        clearTimeout(syncTimerRef.current); syncTimerRef.current = null; }, []);
    const discardRecovery = () => { void saveLiveGameOutbox([], currentUserId); setRecoveryOutbox([]); };
    const archivedPendingCount = recoveryOutbox.reduce((count, item) => count + countLiveGamePendingOperations({ mutations: item.mutations.length,
        needsCreate: item.needsCreate, finalization: Boolean(item.finalization), cancellation: item.cancel }), 0);
    return { journal, liveGame, undoDepth, redoDepth, pendingSyncCount, localPersistenceAvailable, booting, syncStatus, syncError, authenticationRequired,
        networkOnline, recoveryCount: recoveryOutbox.length, archivedPendingCount, saveJournal, syncJournal, flushArchivedOutbox, cancelScheduledSync,
        enqueueMutation, handleUndo, handleRedo, discardRecovery };
}
