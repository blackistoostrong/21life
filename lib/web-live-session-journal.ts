import { applyLiveGameMutation, type LiveGameMutation, type LiveGameRecord, type QueuedLiveGameMutation } from '@/lib/live-game';
import { createLiveGameHistory, recordLiveGameHistory, undoLiveGameHistory, redoLiveGameHistory, type LiveGameHistory } from '@/lib/live-game-history';
import { clearWebLiveGameJournal, loadWebLiveGameJournal, saveWebLiveGameJournal, type WebLiveGameJournal, type PendingLiveGameFinalization, type WebJournalError } from '@/lib/live-game-offline';
import { countLiveGamePendingOperations } from '@/lib/live-game-sync-presentation';
import { recordLiveGameQueueDepth } from '@/lib/live-game-telemetry';
export type WebSessionJournalSnapshot = Readonly<{
    record: LiveGameRecord | null;
    serverRecord: LiveGameRecord | null;
    mutations: readonly QueuedLiveGameMutation[];
    needsCreate: boolean;
    pendingFinalization: PendingLiveGameFinalization | null;
    pendingCancel: boolean;
    history: LiveGameHistory;
    batchStartedAt: number | null;
    error: WebJournalError | null;
}>;
function empty(): WebSessionJournalSnapshot {
    return { record: null, serverRecord: null, mutations: [], needsCreate: false, pendingFinalization: null,
        pendingCancel: false, history: createLiveGameHistory(), batchStartedAt: null, error: null };
}
const replay = (record: LiveGameRecord, queue: readonly QueuedLiveGameMutation[]) => queue.reduce((current, item) => ({ ...current, state: applyLiveGameMutation(current.state, item.mutation) }), record);
/** Per-opening owner. Consumers receive snapshots/actions, never mutable journal refs. */
export function createWebLiveSessionJournal(groupId: string, userId: string, changed: () => void = () => { }) {
    let active = false;
    let snapshot = empty();
    const listeners = new Set<() => void>();
    const notify = () => { changed(); Array.from(listeners).forEach(listener => listener()); };
    const update = (patch: Partial<WebSessionJournalSnapshot>) => {
        if (!active)
            return false;
        if ((Object.keys(patch) as Array<keyof WebSessionJournalSnapshot>).every(key => snapshot[key] === patch[key]))
            return true;
        snapshot = { ...snapshot, ...patch };
        notify();
        return true;
    };
    const persist = () => {
        if (!active || !snapshot.record || !snapshot.serverRecord)
            return;
        const result = saveWebLiveGameJournal(groupId, {
            record: snapshot.record, serverRecord: snapshot.serverRecord, mutations: [...snapshot.mutations],
            needsCreate: snapshot.needsCreate, pendingFinalization: snapshot.pendingFinalization,
            pendingCancel: snapshot.pendingCancel, history: snapshot.history,
        }, userId);
        update({ error: result.ok ? null : result.error });
    };
    const hasPending = () => snapshot.needsCreate || snapshot.mutations.length > 0 || Boolean(snapshot.pendingFinalization) || snapshot.pendingCancel;
    const enqueue = (mutation: LiveGameMutation, inverse?: LiveGameMutation, historyMode: 'record' | 'skip' = 'record') => {
        if (!active || !snapshot.record)
            return false;
        const id = crypto.randomUUID();
        const tracked = { ...mutation, eventId: mutation.eventId ?? id, occurredAt: mutation.occurredAt ?? new Date().toISOString() };
        const mutations = [...snapshot.mutations, { id, mutation: tracked }];
        const history = inverse && historyMode === 'record' ? recordLiveGameHistory(snapshot.history, { forward: mutation, inverse }) : snapshot.history;
        update({ record: { ...snapshot.record, state: applyLiveGameMutation(snapshot.record.state, tracked) }, mutations, history,
            batchStartedAt: snapshot.batchStartedAt ?? Date.now() });
        recordLiveGameQueueDepth(mutations.length);
        persist();
        return true;
    };
    return {
        activate() { active = true; },
        deactivate() { active = false; },
        isActive: () => active,
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        pendingCount: () => countLiveGamePendingOperations({ mutations: snapshot.mutations.length, needsCreate: snapshot.needsCreate,
            finalization: Boolean(snapshot.pendingFinalization), cancellation: snapshot.pendingCancel }),
        readSaved: () => active ? loadWebLiveGameJournal(groupId, userId) : { journal: null, error: null },
        restore(saved: WebLiveGameJournal) {
            if (saved.record.group_id !== groupId || (saved.record.created_by !== userId && !saved.record.state.players.some(player => player.participantKey === `user:${userId}`))) {
                update({ error: 'ownership' });
                return;
            }
            update({ record: saved.record, serverRecord: saved.serverRecord, mutations: saved.mutations,
                needsCreate: saved.needsCreate, pendingFinalization: saved.pendingFinalization, pendingCancel: saved.pendingCancel,
                history: saved.history, batchStartedAt: saved.mutations.length ? Date.now() : null });
        },
        start(record: LiveGameRecord) {
            if (!active)
                return false;
            if (snapshot.record && snapshot.record.id !== record.id && hasPending()) {
                update({ error: 'pending_game' });
                return false;
            }
            snapshot = { ...empty(), record, serverRecord: record, needsCreate: true };
            notify();
            return true;
        },
        acceptCreated(remote: LiveGameRecord) {
            if (snapshot.record?.id !== remote.id)
                return false;
            return update({ serverRecord: remote, needsCreate: false });
        },
        acknowledgeBatch(remote: LiveGameRecord, batch: readonly QueuedLiveGameMutation[]) {
            if (!active || snapshot.record?.id !== remote.id || batch.some((item, index) => snapshot.mutations[index]?.id !== item.id))
                return false;
            const mutations = snapshot.mutations.slice(batch.length);
            update({ serverRecord: remote, mutations, record: replay(remote, mutations), batchStartedAt: mutations.length ? snapshot.batchStartedAt : null });
            persist();
            return true;
        },
        applyRemote(remote: LiveGameRecord) {
            if (!active || snapshot.record?.id !== remote.id)
                return false;
            update({ serverRecord: remote, record: replay(remote, snapshot.mutations) });
            persist();
            return true;
        },
        resume(remote: LiveGameRecord) {
            if (!active)
                return false;
            const same = snapshot.record?.id === remote.id;
            if (snapshot.record && !same && hasPending()) {
                update({ error: 'pending_game' });
                return false;
            }
            const mutations = same ? snapshot.mutations : [];
            update({ serverRecord: remote, record: replay(remote, mutations), mutations, needsCreate: false,
                history: same ? snapshot.history : createLiveGameHistory(),
                pendingFinalization: same ? snapshot.pendingFinalization : null, pendingCancel: same && snapshot.pendingCancel,
                batchStartedAt: mutations.length ? Date.now() : null });
            persist();
            return true;
        },
        requestFinalization(value: PendingLiveGameFinalization) { if (update({ pendingFinalization: value }))
            persist(); },
        requestCancellation() { if (update({ pendingCancel: true }))
            persist(); },
        finish(gameId: string) {
            if (!active || snapshot.record?.id !== gameId)
                return false;
            const result = clearWebLiveGameJournal(groupId, userId, gameId);
            snapshot = { ...empty(), error: result.ok ? null : result.error };
            notify();
            return true;
        },
        markUnavailable() { update({ error: 'unavailable' }); },
        enqueue,
        undo() {
            if (!active)
                return false;
            const result = undoLiveGameHistory(snapshot.history);
            if (!result)
                return false;
            update({ history: result.history });
            return enqueue(result.mutation, undefined, 'skip');
        },
        redo() {
            if (!active)
                return false;
            const result = redoLiveGameHistory(snapshot.history);
            if (!result)
                return false;
            update({ history: result.history });
            return enqueue(result.mutation, undefined, 'skip');
        },
        persist,
    };
}
export type WebLiveSessionJournal = ReturnType<typeof createWebLiveSessionJournal>;
