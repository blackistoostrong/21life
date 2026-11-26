'use client';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { createWebLiveSessionJournal } from '@/lib/web-live-session-journal';
/** React observes the single journal owner instead of maintaining parallel refs/state. */
export function useWebLiveJournal(groupId: string, userId: string) {
    const journal = useMemo(() => createWebLiveSessionJournal(groupId, userId), [groupId, userId]);
    useLayoutEffect(() => {
        journal.activate();
        return () => journal.deactivate();
    }, [journal]);
    const snapshot = useSyncExternalStore(journal.subscribe, journal.getSnapshot, journal.getSnapshot);
    return { journal, snapshot };
}
