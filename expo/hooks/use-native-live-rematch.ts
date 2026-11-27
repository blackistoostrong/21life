import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useLanguage } from '@/contexts/language-context';
import { useToast } from '@/contexts/toast-context';
import { createLiveGameRound } from '@/lib/live-game-round';
import { fetchBusyLiveGameParticipantKeys } from '@/lib/live-game-service';
import { createLiveGameReferenceReader } from '@/lib/live-game-reference-reader';
import { withLiveGameTimeout } from '@/lib/live-game-async';
import { LiveGameReferenceReadError, readLiveGameRoundReferences } from '../../packages/data/live-game-round-references';
import { liveGameReferenceStamp, reconcileLiveGameReferences, type LiveGameSeatReference } from '../../packages/domain/live-game-reference-validation';
import type { LiveGameRecord } from '@/lib/live-game';
import type { ParticipantKey } from '@/lib/participant-keys';
import type { useLiveGameCommandScope } from './use-live-game-command-scope';
import type { useNativeLiveSetup } from './use-native-live-setup';
import type { useNativeLiveSession } from './use-native-live-session';
import type { useArena } from './use-arena';
import type { NativeRoundPresentationEvent } from './use-native-live-round-commands';
type Ports = {
    groupId: string;
    user: {
        id: string;
    } | null;
    completedGame: LiveGameRecord | null;
    rematchOpen: boolean;
    scope: Pick<ReturnType<typeof useLiveGameCommandScope>, 'epoch' | 'isCurrent' | 'bindClient' | 'beginCommand'>;
    setup: Pick<ReturnType<typeof useNativeLiveSetup>, 'getDeckOptions' | 'setPlayerCount' | 'setLayoutVariant' | 'applySeatSetups' | 'applyStartingLife'>;
    session: Pick<ReturnType<typeof useNativeLiveSession>, 'journal' | 'saveJournal' | 'syncJournal' | 'networkOnline'>;
    catalog: Pick<ReturnType<typeof useArena>, 'members' | 'guests'>;
    presentation: {
        onEvent: (event: NativeRoundPresentationEvent) => void;
        revealStartingPlayer: (key: ParticipantKey | null, pool: ParticipantKey[]) => void;
    };
};
/** Rematch owns its recap opening, reference reads and one scoped command. */
export function useNativeLiveRematch({ groupId, user, completedGame, rematchOpen, scope, setup, session, catalog, presentation }: Ports) {
    const { epoch, isCurrent: isLiveScopeCurrent, bindClient: bindLiveClient, beginCommand: beginLiveCommand } = scope;
    const { journal, saveJournal, syncJournal, networkOnline } = session;
    const { getDeckOptions, setPlayerCount, setLayoutVariant, applySeatSetups, applyStartingLife } = setup;
    const { members, guests } = catalog;
    const { onEvent, revealStartingPlayer } = presentation;
    const { copy } = useLanguage();
    const { showToast } = useToast();
    const router = useRouter();
    const [starting, setStarting] = useState(false);
    const opening = useMemo(() => ({ epoch, recordId: completedGame?.id, open: rematchOpen }), [epoch, completedGame?.id, rematchOpen]);
    const openingRef = useRef<typeof opening | null>(null);
    const referenceRequestRef = useRef<{
        opening: typeof opening;
        controller: AbortController;
    } | null>(null);
    const catalogRef = useRef({ members, guests, getDeckOptions });
    useLayoutEffect(() => { catalogRef.current = { members, guests, getDeckOptions }; }, [members, guests, getDeckOptions]);
    useLayoutEffect(() => {
        openingRef.current = opening;
        setStarting(false);
        return () => {
            if (openingRef.current === opening)
                openingRef.current = null;
            const request = referenceRequestRef.current;
            if (request?.opening === opening) {
                referenceRequestRef.current = null;
                request.controller.abort();
            }
        };
    }, [opening]);
    const readReferenceStamp = useCallback((seats: readonly LiveGameSeatReference[]) => {
        const current = catalogRef.current;
        return liveGameReferenceStamp(seats, [
            ...current.members.map(member => { const key = `user:${member.id}` as const; return { key, decks: current.getDeckOptions(key) }; }),
            ...current.guests.map(guest => { const key = `guest:${guest.id}` as const; return { key, decks: current.getDeckOptions(key) }; }),
        ]);
    }, []);
    const preparePreviousPod = useCallback((seats?: LiveGameSeatReference[]) => {
        const previous = completedGame;
        if (!previous)
            return null;
        const ordered = [...previous.state.players].sort((a, b) => a.slot - b.slot);
        setPlayerCount(ordered.length);
        setLayoutVariant(previous.state.layoutVariant ?? 'classic');
        applySeatSetups(seats ?? ordered.map(player => ({ participantKey: player.participantKey, deckId: player.deckId })));
        applyStartingLife(previous.starting_life);
        return previous;
    }, [applySeatSetups, applyStartingLife, completedGame, setLayoutVariant, setPlayerCount]);
    const handleRematchSameDecks = useCallback(async () => {
        if (!user || !isLiveScopeCurrent() || openingRef.current !== opening || !opening.open)
            return;
        const command = beginLiveCommand();
        if (!command)
            return;
        const controller = new AbortController();
        const request = { opening, controller };
        referenceRequestRef.current = request;
        let committedId: string | null = null;
        const active = () => command.isCurrent() && (committedId
            ? journal.getSnapshot().record?.id === committedId && !journal.getSnapshot().closed
            : openingRef.current === opening && !controller.signal.aborted);
        setStarting(true);
        try {
            const previous = preparePreviousPod();
            if (!previous || previous.group_id !== groupId)
                return;
            const ordered = [...previous.state.players].sort((a, b) => a.slot - b.slot);
            const seats = ordered.map(player => ({ participantKey: player.participantKey, deckId: player.deckId }));
            const keys = ordered.map(player => player.participantKey);
            let resolved = ordered;
            if (networkOnline) {
                try {
                    const { client } = bindLiveClient();
                    const busy = await withLiveGameTimeout(fetchBusyLiveGameParticipantKeys(client, groupId, keys, { excludeLiveGameId: previous.id, signal: controller.signal }));
                    if (!active())
                        return;
                    if (busy.length) {
                        onEvent({ type: 'rematch-prepared' });
                        showToast(copy('liveGamePlayersBusy'));
                        return;
                    }
                    for (let attempt = 0; attempt < 2; attempt++) {
                        const stamp = readReferenceStamp(seats);
                        const result = await readLiveGameRoundReferences(createLiveGameReferenceReader(client), { groupId, actorId: user.id, seats }, controller.signal);
                        if (!active())
                            return;
                        if (result.kind === 'denied') {
                            showToast(copy('liveGameStartFailed'));
                            router.replace(`/table/${groupId}`);
                            return;
                        }
                        if (stamp !== readReferenceStamp(seats)) {
                            if (attempt === 0)
                                continue;
                            showToast(copy('liveGameRematchUnavailable'));
                            return;
                        }
                        const plan = reconcileLiveGameReferences(seats, result.participants, { allowArchived: true });
                        if (plan.issues.length) {
                            preparePreviousPod(plan.seats);
                            onEvent({ type: 'rematch-prepared' });
                            showToast(copy('liveGameRematchUnavailable'));
                            return;
                        }
                        resolved = plan.resolved.map((seat, index) => ({ ...ordered[index], ...seat }));
                        break;
                    }
                }
                catch (error) {
                    if (!active())
                        return;
                    if (error instanceof LiveGameReferenceReadError && error.kind === 'invalid') {
                        showToast(copy('liveGameRematchUnavailable'));
                        return;
                    }
                    // Preserve native offline starts when transport is unavailable. The old
                    // snapshot remains scoped; the existing outbox still replays before create.
                }
            }
            if (!active())
                return;
            const record = createLiveGameRound({ id: Crypto.randomUUID(), groupId, actorId: user.id, startedAt: new Date().toISOString(),
                startingLife: previous.starting_life, layoutVariant: previous.state.layoutVariant ?? 'classic', seats: resolved, random: Math.random });
            if (referenceRequestRef.current === request)
                referenceRequestRef.current = null;
            if (!journal.start(record)) {
                showToast(copy('liveGamePreviousPending'));
                return;
            }
            committedId = record.id;
            revealStartingPlayer(record.state.startingPlayerKey ?? null, keys);
            onEvent({ type: 'rematch-prepared' });
            await saveJournal();
            if (active())
                void syncJournal();
        }
        catch {
            if (active())
                showToast(copy('liveGameStartFailed'));
        }
        finally {
            if (referenceRequestRef.current === request)
                referenceRequestRef.current = null;
            controller.abort();
            if (command.isCurrent())
                setStarting(false);
            command.release();
        }
    }, [user, isLiveScopeCurrent, opening, beginLiveCommand, journal, preparePreviousPod, groupId, networkOnline, bindLiveClient,
        onEvent, showToast, copy, readReferenceStamp, router, revealStartingPlayer, saveJournal, syncJournal]);
    const handleRematchReselect = useCallback(() => {
        if (!isLiveScopeCurrent() || openingRef.current !== opening || !opening.open || starting)
            return;
        preparePreviousPod();
        onEvent({ type: 'rematch-prepared' });
    }, [isLiveScopeCurrent, opening, starting, preparePreviousPod, onEvent]);
    return { starting, handleRematchSameDecks, handleRematchReselect };
}
