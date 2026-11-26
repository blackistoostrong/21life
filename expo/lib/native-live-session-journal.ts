import { createStore } from 'zustand/vanilla';
import { applyLiveGameMutation, type LiveGameMutation, type LiveGameRecord, type QueuedLiveGameMutation } from './live-game';
import { createLiveGameHistory, recordLiveGameHistory, undoLiveGameHistory, redoLiveGameHistory, type LiveGameHistory } from './live-game-history';
import { archiveAndClearLiveGameSession, clearLiveGameOfflineSessionIfMatches, loadLiveGameOfflineSession, prepareLiveGameReplacement, saveLiveGameOfflineSession, type LiveGameOfflineSession, type PendingLiveGameFinalization } from './live-game-offline';
import { queueLiveGameJournalWrite } from './live-game-journal-writer';
import { countLiveGamePendingOperations } from './live-game-sync-presentation';
import { recordLiveGameQueueDepth } from './live-game-telemetry';
export type NativeLiveJournalSnapshot = Readonly<{
    record: LiveGameRecord | null;
    serverRecord: LiveGameRecord | null;
    mutations: readonly QueuedLiveGameMutation[];
    needsCreate: boolean;
    pendingFinalization: PendingLiveGameFinalization | null;
    pendingCancel: boolean;
    history: LiveGameHistory;
    batchStartedAt: number | null;
    closed: boolean;
    localPersistenceAvailable: boolean;
}>;
type Ports = {
    isCurrent: () => boolean;
    randomUUID: () => string;
};
const empty = (): NativeLiveJournalSnapshot => ({ record: null, serverRecord: null, mutations: [], needsCreate: false,
    pendingFinalization: null, pendingCancel: false, history: createLiveGameHistory(), batchStartedAt: null,
    closed: false, localPersistenceAvailable: true });
const replay = (record: LiveGameRecord, queue: readonly QueuedLiveGameMutation[]) => ({ ...record,
    state: queue.reduce((state, item) => applyLiveGameMutation(state, item.mutation), record.state) });
/** One opening owns memory and durable snapshots; storage owns the account I/O queue. */
export function createNativeLiveSessionJournal(groupId: string | undefined, actorId: string | undefined, ports: Ports) {
    const store = createStore<NativeLiveJournalSnapshot>(() => empty());
    let mounted = false;
    let pendingWrite = Promise.resolve();
    const active = () => mounted && Boolean(groupId && actorId) && ports.isCurrent();
    const owned = (record: LiveGameRecord) => record.group_id === groupId && (record.created_by === actorId || record.state.players.some(player => player.participantKey === `user:${actorId}`));
    const update = (patch: Partial<NativeLiveJournalSnapshot>) => {
        if (!active())
            return false;
        const previous = store.getState();
        if ((Object.keys(patch) as (keyof NativeLiveJournalSnapshot)[]).every(key => previous[key] === patch[key]))
            return true;
        const next = { ...previous, ...patch };
        store.setState(next, true);
        return true;
    };
    const payload = (): Omit<LiveGameOfflineSession, 'savedAt'> | null => {
        const value = store.getState();
        if (!value.record || !value.serverRecord)
            return null;
        return { record: value.record, serverRecord: value.serverRecord, mutations: [...value.mutations], needsCreate: value.needsCreate,
            pendingFinalization: value.pendingFinalization, pendingCancel: value.pendingCancel, history: value.history };
    };
    const hasPending = () => {
        const value = store.getState();
        return value.needsCreate || value.mutations.length > 0 || Boolean(value.pendingFinalization) || value.pendingCancel;
    };
    const persist = () => {
        const snapshot = payload();
        if (!active() || store.getState().closed || !snapshot)
            return Promise.resolve();
        pendingWrite = queueLiveGameJournalWrite(pendingWrite, () => saveLiveGameOfflineSession(groupId!, snapshot, actorId), saved => { if (active() && !store.getState().closed)
            update({ localPersistenceAvailable: saved }); });
        return pendingWrite;
    };
    const restore = (saved: Omit<LiveGameOfflineSession, 'savedAt'>) => {
        if (!owned(saved.record))
            return false;
        return update({ record: saved.record, serverRecord: saved.serverRecord,
            mutations: saved.mutations, needsCreate: saved.needsCreate, pendingFinalization: saved.pendingFinalization,
            pendingCancel: saved.pendingCancel, history: saved.history, batchStartedAt: saved.mutations.length ? Date.now() : null, closed: false });
    };
    const reset = (closed = false) => update({ ...empty(), closed, localPersistenceAvailable: store.getState().localPersistenceAvailable });
    const enqueue = (mutation: LiveGameMutation, inverse?: LiveGameMutation, historyMode: 'record' | 'skip' = 'record'): Promise<void> | null => {
        const value = store.getState();
        if (!active() || value.closed || value.pendingFinalization || value.pendingCancel || !value.record)
            return null;
        const id = ports.randomUUID();
        const tracked = { ...mutation, eventId: mutation.eventId ?? id, occurredAt: mutation.occurredAt ?? new Date().toISOString() };
        const mutations = [...value.mutations, { id, mutation: tracked }];
        update({ mutations, batchStartedAt: value.batchStartedAt ?? Date.now(),
            record: { ...value.record, state: applyLiveGameMutation(value.record.state, tracked) },
            history: inverse && historyMode === 'record' ? recordLiveGameHistory(value.history, { forward: mutation, inverse }) : value.history });
        recordLiveGameQueueDepth(mutations.length);
        return persist();
    };
    return {
        activate() { mounted = true; }, deactivate() { mounted = false; },
        view: { getState: store.getState, getInitialState: store.getInitialState, subscribe: store.subscribe },
        getSnapshot: store.getState,
        pendingCount: () => {
            const value = store.getState();
            return countLiveGamePendingOperations({ mutations: value.mutations.length,
                needsCreate: value.needsCreate, finalization: Boolean(value.pendingFinalization), cancellation: value.pendingCancel });
        },
        loadSaved: () => active() ? loadLiveGameOfflineSession(groupId!, actorId).catch(error => {
            if (active())
                update({ localPersistenceAvailable: false });
            throw error;
        }) : Promise.resolve(null),
        restore,
        start(record: LiveGameRecord) {
            if (!owned(record))
                return false;
            const old = store.getState();
            if (old.closed && old.record)
                return false;
            if (old.record && old.record.id !== record.id && hasPending() && !old.closed)
                return false;
            return update({ ...empty(), record, serverRecord: record, needsCreate: true, localPersistenceAvailable: old.localPersistenceAvailable });
        },
        acceptCreated(remote: LiveGameRecord) {
            if (!owned(remote) || store.getState().record?.id !== remote.id || store.getState().closed)
                return false;
            return update({ serverRecord: remote, needsCreate: false });
        },
        acknowledgeBatch(remote: LiveGameRecord, batch: readonly QueuedLiveGameMutation[]) {
            const value = store.getState();
            if (!owned(remote) || value.record?.id !== remote.id || value.closed || batch.some((item, index) => value.mutations[index]?.id !== item.id))
                return false;
            const mutations = value.mutations.slice(batch.length);
            return update({ serverRecord: remote, mutations, record: replay(remote, mutations), batchStartedAt: mutations.length ? value.batchStartedAt : null });
        },
        applyRemote(remote: LiveGameRecord) {
            const value = store.getState();
            if (!owned(remote) || value.record?.id !== remote.id || value.closed)
                return false;
            return update({ serverRecord: remote, record: replay(remote, value.mutations) });
        },
        async replaceRemote(remote: LiveGameRecord) {
            if (!active() || store.getState().closed || !owned(remote))
                return false;
            const previous = payload();
            if (previous?.needsCreate && previous.record.id !== remote.id)
                return false;
            if (previous && previous.record.id !== remote.id) {
                update({ closed: true });
                try {
                    const prepared = await prepareLiveGameReplacement(groupId!, { ...previous, savedAt: new Date().toISOString() }, remote, pendingWrite, actorId);
                    if (!active())
                        return false;
                    return restore(prepared);
                }
                catch (error) {
                    if (active())
                        update({ closed: false, localPersistenceAvailable: false });
                    throw error;
                }
            }
            const value = store.getState();
            return restore({ record: replay(remote, value.mutations), serverRecord: remote, mutations: [...value.mutations], needsCreate: false,
                pendingFinalization: value.pendingFinalization, pendingCancel: value.pendingCancel, history: value.history });
        },
        async forgetClean() {
            if (!active() || hasPending())
                return false;
            const id = store.getState().record?.id;
            update({ closed: true });
            try {
                if (id)
                    await clearLiveGameOfflineSessionIfMatches(groupId!, id, actorId);
                if (!active())
                    return false;
                return reset();
            }
            catch (error) {
                if (active())
                    update({ closed: false, localPersistenceAvailable: false });
                throw error;
            }
        },
        async archive(finalization: PendingLiveGameFinalization | null, cancel: boolean) {
            const previous = store.getState();
            const saved = payload();
            if (!active() || previous.closed || !saved)
                return false;
            update({ closed: true, pendingFinalization: finalization, pendingCancel: cancel });
            try {
                await archiveAndClearLiveGameSession(groupId!, { id: saved.record.id, serverRecord: saved.serverRecord,
                    needsCreate: saved.needsCreate, mutations: saved.mutations, finalization, cancel }, actorId);
                if (active())
                    reset(true);
                return true;
            }
            catch (error) {
                if (active())
                    update({ closed: previous.closed, pendingFinalization: previous.pendingFinalization,
                        pendingCancel: previous.pendingCancel, localPersistenceAvailable: false });
                throw error;
            }
        },
        async closeRemote() {
            if (!active())
                return false;
            if (hasPending())
                return false;
            const saved = payload();
            update({ closed: true });
            try {
                if (saved)
                    await clearLiveGameOfflineSessionIfMatches(groupId!, saved.record.id, actorId);
                if (!active())
                    return false;
                return reset(true);
            }
            catch (error) {
                if (active())
                    update({ closed: false, localPersistenceAvailable: false });
                throw error;
            }
        },
        async acknowledgeCancellation(gameId: string) {
            const value = store.getState();
            if (!active() || value.record?.id !== gameId || value.mutations.length)
                return false;
            update({ closed: true });
            try {
                await clearLiveGameOfflineSessionIfMatches(groupId!, gameId, actorId);
                if (!active())
                    return false;
                return reset(true);
            }
            catch (error) {
                if (active())
                    update({ closed: false, localPersistenceAvailable: false });
                throw error;
            }
        },
        markUnavailable() { update({ localPersistenceAvailable: false }); },
        enqueue,
        undo(): Promise<void> | null {
            if (!active() || store.getState().closed)
                return null;
            const result = undoLiveGameHistory(store.getState().history);
            if (!result)
                return null;
            update({ history: result.history });
            return enqueue(result.mutation, undefined, 'skip');
        },
        redo(): Promise<void> | null {
            if (!active() || store.getState().closed)
                return null;
            const result = redoLiveGameHistory(store.getState().history);
            if (!result)
                return null;
            update({ history: result.history });
            return enqueue(result.mutation, undefined, 'skip');
        },
        persist,
    };
}
export type NativeLiveSessionJournal = ReturnType<typeof createNativeLiveSessionJournal>;
