import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useStore } from 'zustand';
import { createNativeLiveSessionJournal } from '../lib/native-live-session-journal';
import { claimLiveGameRuntimePresentation } from '../stores/live-game-runtime-store';
type Scope = {
    epoch: unknown;
    isCurrent: () => boolean;
};
/** Private state survives focus changes; only the focused view owns the player projection. */
export function useNativeLiveJournal(groupId: string | undefined, actorId: string | undefined, scope: Scope) {
    const { epoch, isCurrent } = scope;
    const identity = useMemo(() => ({ groupId, actorId, epoch }), [groupId, actorId, epoch]);
    const presentation = useRef<ReturnType<typeof claimLiveGameRuntimePresentation> | null>(null);
    const journal = useMemo(() => createNativeLiveSessionJournal(identity.groupId, identity.actorId, {
        randomUUID: () => Crypto.randomUUID(), isCurrent,
    }), [identity, isCurrent]);
    useLayoutEffect(() => {
        journal.activate();
        const stop = journal.view.subscribe((value, previous) => {
            if (value.record !== previous.record)
                presentation.current?.replace(value.record?.state.players ?? []);
        });
        return () => { journal.deactivate(); stop(); };
    }, [journal]);
    useFocusEffect(useCallback(() => {
        const owned = claimLiveGameRuntimePresentation();
        presentation.current = owned;
        owned.replace(journal.getSnapshot().record?.state.players ?? []);
        return () => { owned.release(); if (presentation.current === owned)
            presentation.current = null; };
    }, [journal]));
    const snapshot = useStore(journal.view);
    return { journal, snapshot };
}
