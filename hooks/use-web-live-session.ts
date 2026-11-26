'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { useCommandScope } from '@/hooks/use-command-scope';
import { useWebLiveJournal } from '@/hooks/use-web-live-journal';
import { createWebLiveCommandClient } from '@/lib/web-live-command-client';
import { supabase } from '@/lib/supabase';
import { applyQueuedLiveGameMutations, cancelLiveGame, ensureLiveGameCreated, fetchActiveLiveGame, finalizeLiveGameAsMatch, subscribeToLiveGame } from '@/lib/live-game-service';
import { persistLiveGameTelemetry } from '@/lib/live-game-telemetry';
import { isLiveGameAuthenticationError } from '@/lib/live-game-sync-presentation';
import { LIVE_GAME_SYNC_BATCH_SIZE, getLiveGameSyncDelay } from '@/lib/live-game-sync-policy';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { webJournalHasPendingOperations } from '@/lib/live-game-journal-contract';
import type { WebJournalError } from '@/lib/live-game-offline';
import type { LiveGameRecord } from '@/lib/live-game';
import type { ParticipantKey } from '@/lib/participant-keys';
type Ports = {
    onCompleted: (record: LiveGameRecord, endedAt: string) => void;
    onRemoteCompleted: (record: LiveGameRecord, duration: string) => void;
    onCancelled: () => void;
    readDuration: () => string;
};
/** Owns one opening's bootstrap, network lifecycle, Realtime and synchronization. */
export function useWebLiveSession(groupId: string, userId: string, { onCompleted: showCompletedGame, onRemoteCompleted, onCancelled: clearCancelledGame, readDuration }: Ports) {
    const router = useRouter();
    const { copy } = useLanguage();
    const { toast } = useToast();
    const { begin: beginLiveJob, committed: isLiveCurrent, cancel: cancelLiveJob } = useCommandScope<'sync' | 'refresh' | 'bootstrap' | 'command' | 'telemetry'>(`${userId}:${groupId}`, true);
    const { journal, snapshot: journalSnapshot } = useWebLiveJournal(groupId, userId);
    const record = journalSnapshot.record;
    const activeRecordId = journalSnapshot.needsCreate ? undefined : record?.id;
    const undoDepth = journalSnapshot.history.undo.length;
    const redoDepth = journalSnapshot.history.redo.length;
    const pendingSyncCount = journal.pendingCount();
    const localSaveError = journalSnapshot.error;
    const [booting, setBooting] = useState(true);
    const syncingRef = useRef(false);
    const syncTimerRef = useRef<number | null>(null);
    const [online, setOnline] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [recoveryIssue, setRecoveryIssue] = useState<WebJournalError | null>(null);
    const [authenticationRequired, setAuthenticationRequired] = useState(false);
    const [recoveredJournal, setRecoveredJournal] = useState(false);
    const telemetrySessionRef = useRef(globalThis.crypto.randomUUID());
    const persist = journal.persist;
    const clearJournal = journal.finish;
    const flush = useCallback(async () => {
        if (syncTimerRef.current !== null) {
            window.clearTimeout(syncTimerRef.current);
            syncTimerRef.current = null;
        }
        if (!isLiveCurrent() || syncingRef.current || !journal.getSnapshot().record || !journal.getSnapshot().serverRecord || !navigator.onLine)
            return false;
        const job = beginLiveJob('sync');
        if (!job)
            return false;
        syncingRef.current = true;
        setSyncing(true);
        setSyncError(null);
        let failed = false;
        let commandClient: Awaited<ReturnType<typeof createWebLiveCommandClient>> | null = null;
        try {
            commandClient = await createWebLiveCommandClient(userId, job.signal);
            if (!job.active())
                return false;
            const { client, accessToken } = commandClient;
            let server = journal.getSnapshot().serverRecord;
            const initial = journal.getSnapshot().record;
            if (!server || !initial)
                return false;
            if (journal.getSnapshot().needsCreate) {
                server = await ensureLiveGameCreated(client, initial);
                if (!job.active())
                    return false;
                if (!journal.acceptCreated(server))
                    return false;
            }
            while (journal.getSnapshot().mutations.length > 0) {
                const batch = journal.getSnapshot().mutations.slice(0, LIVE_GAME_SYNC_BATCH_SIZE);
                server = await applyQueuedLiveGameMutations(client, server, batch);
                if (!job.active())
                    return false;
                if (!journal.acknowledgeBatch(server, batch))
                    return false;
            }
            const finalization = journal.getSnapshot().pendingFinalization;
            if (finalization) {
                const completed = journal.getSnapshot().record;
                const matchId = await finalizeLiveGameAsMatch(client, {
                    liveGameId: server.id,
                    ...finalization,
                });
                if (!job.active())
                    return false;
                void withRequestDeadline({ abortSignal: signal => fetch('/api/notifications/match-completed', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
                        signal,
                        body: JSON.stringify({ matchId }),
                    }) }, 5000, job.signal).catch(() => undefined);
                clearJournal(server.id);
                if (completed)
                    showCompletedGame(completed, finalization.endedAt);
                return true;
            }
            if (journal.getSnapshot().pendingCancel) {
                await cancelLiveGame(client, server.id);
                if (!job.active())
                    return false;
                clearJournal(server.id);
                clearCancelledGame();
                return true;
            }
            persist();
            return true;
        }
        catch (error) {
            if (!job.active())
                return false;
            failed = true;
            setAuthenticationRequired(isLiveGameAuthenticationError(error));
            persist();
            setSyncError(error instanceof Error ? error.message : 'Sync failed');
            console.error('Web live-game sync failed', error);
            return false;
        }
        finally {
            if (job.active()) {
                syncingRef.current = false;
                setSyncing(false);
                if (!failed)
                    setAuthenticationRequired(false);
                if (commandClient)
                    void persistLiveGameTelemetry(commandClient.client, {
                        userId,
                        liveGameId: journal.getSnapshot().record?.id ?? null,
                        sessionId: telemetrySessionRef.current,
                        platform: 'web',
                        force: failed,
                    }).catch(() => undefined);
            }
            job.finish();
        }
    }, [beginLiveJob, isLiveCurrent, journal, clearCancelledGame, clearJournal, persist, showCompletedGame, userId]);
    const scheduleFlush = useCallback(() => {
        if (syncTimerRef.current !== null)
            window.clearTimeout(syncTimerRef.current);
        const delay = getLiveGameSyncDelay({
            queueDepth: journal.getSnapshot().mutations.length,
            batchStartedAt: journal.getSnapshot().batchStartedAt,
        });
        syncTimerRef.current = window.setTimeout(() => {
            syncTimerRef.current = null;
            void flush();
        }, delay);
    }, [flush, journal]);
    const refreshAuthoritativeState = useCallback(async () => {
        const current = journal.getSnapshot().record;
        if (!current || journal.getSnapshot().needsCreate || syncingRef.current)
            return;
        const job = beginLiveJob('refresh');
        if (!job)
            return;
        try {
            const { client } = await createWebLiveCommandClient(userId, job.signal);
            if (!job.active())
                return;
            const remote = await fetchActiveLiveGame(client, groupId, `user:${userId}` as ParticipantKey, job.signal);
            if (!job.active())
                return;
            if (!remote || remote.id !== current.id || journal.getSnapshot().record?.id !== current.id)
                return;
            journal.applyRemote(remote);
        }
        finally {
            job.finish();
        }
    }, [beginLiveJob, groupId, journal, userId]);
    useEffect(() => {
        if (journal.getSnapshot().mutations.length > 0)
            scheduleFlush();
        return () => {
            if (syncTimerRef.current !== null) {
                window.clearTimeout(syncTimerRef.current);
                syncTimerRef.current = null;
            }
        };
    }, [scheduleFlush, journal]);
    const sendBackgroundTelemetry = useCallback(() => {
        const job = beginLiveJob('telemetry');
        if (!job)
            return;
        void createWebLiveCommandClient(userId, job.signal).then(({ client }) => {
            if (!job.active())
                return;
            return persistLiveGameTelemetry(client, {
                userId, liveGameId: journal.getSnapshot().record?.id ?? null,
                sessionId: telemetrySessionRef.current, platform: 'web', force: true,
            });
        }).catch(() => undefined).finally(() => job.finish());
    }, [beginLiveJob, journal, userId]);
    useEffect(() => {
        const flushBeforeBackground = () => {
            if (document.visibilityState === 'hidden') {
                if (journal.getSnapshot().mutations.length > 0)
                    void flush();
                sendBackgroundTelemetry();
            }
            else {
                void refreshAuthoritativeState().catch(() => undefined).finally(() => { if (isLiveCurrent())
                    void flush(); });
            }
        };
        const flushBeforeExit = () => {
            if (journal.getSnapshot().mutations.length > 0)
                void flush();
        };
        document.addEventListener('visibilitychange', flushBeforeBackground);
        window.addEventListener('pagehide', flushBeforeExit);
        return () => {
            document.removeEventListener('visibilitychange', flushBeforeBackground);
            window.removeEventListener('pagehide', flushBeforeExit);
        };
    }, [flush, isLiveCurrent, journal, refreshAuthoritativeState, sendBackgroundTelemetry]);
    useEffect(() => {
        setOnline(navigator.onLine);
        const onOnline = () => {
            setOnline(true);
            void refreshAuthoritativeState().catch(() => undefined).finally(() => { if (isLiveCurrent())
                void flush(); });
        };
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, [flush, isLiveCurrent, refreshAuthoritativeState]);
    useEffect(() => {
        const job = beginLiveJob('bootstrap');
        if (!job)
            return;
        let mounted = true;
        void (async () => {
            const participantKey = `user:${userId}` as ParticipantKey;
            const loaded = journal.readSaved();
            const cached = loaded.journal;
            setRecoveryIssue(loaded.error);
            if (cached && (cached.record.created_by === userId || cached.record.state.players.some((player) => player.participantKey === participantKey))) {
                setRecoveredJournal(true);
                journal.restore(cached);
            }
            try {
                const { client } = await createWebLiveCommandClient(userId, job.signal);
                if (!job.active())
                    return;
                if (cached && (cached.pendingFinalization || cached.pendingCancel) && navigator.onLine) {
                    const terminalOperationRecovered = await flush();
                    if (!job.active())
                        return;
                    if (terminalOperationRecovered)
                        return;
                }
                const remote = await fetchActiveLiveGame(client, groupId, participantKey, job.signal);
                if (!mounted || !job.active())
                    return;
                if (remote) {
                    if (cached && cached.record.id !== remote.id && webJournalHasPendingOperations(cached)) {
                        setRecoveryIssue('pending_game');
                        return;
                    }
                    if (!journal.resume(remote)) {
                        setRecoveryIssue('pending_game');
                        return;
                    }
                    void flush();
                }
                else if (cached && !cached.needsCreate) {
                    if (webJournalHasPendingOperations(cached)) {
                        setRecoveryIssue('pending_game');
                        return;
                    }
                    clearJournal(cached.record.id);
                }
                else if (cached?.needsCreate) {
                    persist();
                    void flush();
                }
            }
            catch {
                // The crash-safe local journal remains playable offline.
            }
            finally {
                if (mounted && job.active())
                    setBooting(false);
                job.finish();
            }
        })();
        return () => { mounted = false; cancelLiveJob('bootstrap'); };
    }, [beginLiveJob, cancelLiveJob, journal, clearJournal, flush, groupId, persist, userId]);
    useEffect(() => {
        if (!activeRecordId || journal.getSnapshot().needsCreate)
            return;
        let active = true;
        const stop = subscribeToLiveGame(supabase, activeRecordId, (remote) => {
            if (!active || !isLiveCurrent())
                return;
            // Ignore events from a channel whose removal is still in flight.
            if (journal.getSnapshot().record?.id !== activeRecordId)
                return;
            if (remote.status !== 'active') {
                if (journal.getSnapshot().pendingFinalization || journal.getSnapshot().pendingCancel)
                    return;
                if (journal.getSnapshot().needsCreate || journal.getSnapshot().mutations.length > 0) {
                    setRecoveryIssue('pending_game');
                    return;
                }
                clearJournal(remote.id);
                if (remote.status === 'ended') {
                    onRemoteCompleted(remote, readDuration());
                    toast({ title: copy({ it: 'Partita conclusa su un altro dispositivo', en: 'Game ended on another device' }) });
                }
                else {
                    router.replace(`/table/${groupId}`);
                }
                return;
            }
            if (syncingRef.current)
                return;
            journal.applyRemote(remote);
        }, (status) => {
            if (active && isLiveCurrent() && status === 'SUBSCRIBED') {
                void refreshAuthoritativeState().catch(() => undefined).finally(() => { if (active && isLiveCurrent())
                    void flush(); });
            }
        });
        return () => { active = false; stop(); };
    }, [activeRecordId, onRemoteCompleted, readDuration, journal, clearJournal, copy, flush, groupId, isLiveCurrent, persist, refreshAuthoritativeState, router, toast]);
    const beginRoundCommand = useCallback(() => beginLiveJob('command'), [beginLiveJob]);
    const dismissRecovery = useCallback(() => setRecoveredJournal(false), []);
    return { journal, record, undoDepth, redoDepth, pendingSyncCount, localSaveError, booting, online, syncing, syncError,
        recoveryIssue, authenticationRequired, recoveredJournal, flush, scheduleFlush, beginRoundCommand, dismissRecovery };
}
