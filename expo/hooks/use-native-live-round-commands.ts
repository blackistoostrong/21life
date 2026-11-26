import { useLanguage } from '@/contexts/language-context';
import { useToast } from '@/contexts/toast-context';
import { hapticSuccess } from '@/lib/haptics';
import { isValidLiveGameResult, type LiveGamePlayer, type LiveGameRecord, type WinCondition } from '@/lib/live-game';
import { withLiveGameTimeout } from '@/lib/live-game-async';
import { formatGameDuration, getGameDurationSeconds } from '@/lib/live-game-duration';
import type { PendingLiveGameFinalization } from '@/lib/live-game-offline';
import { createLiveGameRound } from '@/lib/live-game-round';
import { fetchBusyLiveGameParticipantKeys } from '@/lib/live-game-service';
import { saveLiveGameSetup } from '@/lib/live-game-setup';
import { parseParticipantKey, type ParticipantKey } from '@/lib/participant-keys';
import { getProfileDisplayName } from '@/lib/profile-display';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useCallback, useLayoutEffect, useState } from 'react';
import type { useArena } from './use-arena';
import type { useLiveGameCommandScope } from './use-live-game-command-scope';
import type { useNativeLiveSession } from './use-native-live-session';
import type { useNativeLiveSetup } from './use-native-live-setup';
export type NativeRoundPresentationEvent = {
    type: 'finalizing';
    record: LiveGameRecord;
    durationSeconds: number;
} | {
    type: 'completed' | 'discard-finished' | 'end-finished' | 'rematch-prepared';
};
type Ports = {
    groupId: string;
    user: {
        id: string;
    } | null;
    completedGame: LiveGameRecord | null;
    scope: Pick<ReturnType<typeof useLiveGameCommandScope>, 'epoch' | 'isCurrent' | 'bindClient' | 'beginCommand'>;
    setup: Pick<ReturnType<typeof useNativeLiveSetup>, 'selectedKeys' | 'participantDecks' | 'playerCount' | 'setupReadyKey' | 'getDeckOptions' | 'startingLife' | 'layoutVariant' | 'seatSetups' | 'setPlayerCount' | 'setLayoutVariant' | 'applySeatSetups' | 'applyStartingLife'>;
    session: Pick<ReturnType<typeof useNativeLiveSession>, 'journal' | 'liveGame' | 'saveJournal' | 'syncJournal' | 'flushArchivedOutbox' | 'cancelScheduledSync' | 'enqueueMutation'>;
    catalog: Pick<ReturnType<typeof useArena>, 'members' | 'guests'>;
    result: {
        isDraw: boolean;
        winnerKey: ParticipantKey | '';
        winCondition: WinCondition | null;
    };
    presentation: {
        onEvent: (event: NativeRoundPresentationEvent) => void;
        pulseDamage: (key: ParticipantKey) => void;
        revealStartingPlayer: (key: ParticipantKey | null, pool: ParticipantKey[]) => void;
    };
};
/** Owns scoped round commands; presentation receives explicit lifecycle events. */
export function useNativeLiveRoundCommands({ groupId, user, completedGame, scope, setup, session, catalog, result, presentation }: Ports) {
    const { epoch, isCurrent: isLiveScopeCurrent, bindClient: bindLiveClient, beginCommand: beginLiveCommand } = scope;
    const { journal, liveGame, saveJournal, syncJournal, flushArchivedOutbox, cancelScheduledSync, enqueueMutation } = session;
    const { selectedKeys, participantDecks, playerCount, setupReadyKey, getDeckOptions, startingLife, layoutVariant, seatSetups, setPlayerCount, setLayoutVariant, applySeatSetups, applyStartingLife } = setup;
    const { members, guests } = catalog;
    const { isDraw: endIsDraw, winnerKey: endWinnerKey, winCondition: endWinCondition } = result;
    const { onEvent, pulseDamage, revealStartingPlayer } = presentation;
    const { copy } = useLanguage();
    const { showToast } = useToast();
    const router = useRouter();
    const activePlayers = (liveGame?.state.players ?? []).filter(player => !player.isEliminated);
    const [starting, setStarting] = useState(false);
    const [endingGame, setEndingGame] = useState(false);
    const [discardingGame, setDiscardingGame] = useState(false);
    const resolveMeta = (key: ParticipantKey) => {
        const parsed = parseParticipantKey(key);
        if (!parsed)
            return null;
        const deckId = participantDecks[key];
        const deck = getDeckOptions(key).find((entry) => entry.id === deckId);
        if (!deck)
            return null;
        if (parsed.type === 'user') {
            const member = members.find((entry) => entry.id === parsed.id);
            if (!member)
                return null;
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
        if (!guest)
            return null;
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
        if (!isLiveScopeCurrent())
            return;
        if (setupReadyKey !== `${user?.id}:${groupId}`)
            return;
        if (!user)
            return;
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
        if (!command)
            return;
        setStarting(true);
        try {
            try {
                const busyKeys = await withLiveGameTimeout(fetchBusyLiveGameParticipantKeys(bindLiveClient().client, groupId, selectedKeys));
                if (!command.isCurrent())
                    return;
                if (busyKeys.length > 0) {
                    showToast(copy('liveGamePlayersBusy'));
                    return;
                }
            }
            catch {
                // Offline starts remain available; the durable outbox will retry later.
            }
            if (!command.isCurrent())
                return;
            const created = createLiveGameRound({
                id: Crypto.randomUUID(), groupId, actorId: user.id, startedAt: new Date().toISOString(),
                startingLife, layoutVariant, random: Math.random,
                seats: resolvedPlayers.map(({ key, meta }) => ({ participantKey: key, deckId: meta!.deckId,
                    displayName: meta!.displayName, commander: meta!.commander, commanderImage: meta!.commanderImage })),
            });
            if (!journal.start(created))
                throw Error('Previous game has pending operations');
            await saveLiveGameSetup(groupId, user.id, {
                playerCount,
                layoutVariant,
                startingLife,
                seats: seatSetups,
            }).catch(() => undefined);
            if (!command.isCurrent())
                return;
            revealStartingPlayer(created.state.startingPlayerKey ?? null, selectedKeys);
            await saveJournal();
            if (!command.isCurrent())
                return;
            void syncJournal();
            showToast(copy('liveGameStarted'));
        }
        catch {
            if (command.isCurrent())
                showToast(copy('liveGameStartFailed'));
        }
        finally {
            if (command.isCurrent())
                setStarting(false);
            command.release();
        }
    };
    const handleDiscardGame = async () => {
        if (!liveGame || discardingGame || journal.getSnapshot().closed)
            return;
        const command = beginLiveCommand();
        if (!command)
            return;
        setDiscardingGame(true);
        cancelScheduledSync();
        try {
            if (!await journal.archive(null, true) || !command.isCurrent())
                return;
            flushArchivedOutbox();
            hapticSuccess();
            showToast(copy('liveGameDiscarded'));
            router.replace(`/table/${groupId}`);
        }
        catch {
            if (!command.isCurrent())
                return;
            void saveJournal();
            showToast(copy('liveGameDiscardFailed'));
        }
        finally {
            if (command.isCurrent()) {
                setDiscardingGame(false);
                onEvent({ type: 'discard-finished' });
            }
            command.release();
        }
    };
    const handleEndGame = async () => {
        if (!isLiveScopeCurrent())
            return;
        if (!user || !liveGame || endingGame || journal.getSnapshot().closed)
            return;
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
        if (!command)
            return;
        setEndingGame(true);
        try {
            if (!endIsDraw && endWinCondition === 'last_standing' && activePlayers.length > 1 && endWinnerKey) {
                activePlayers
                    .filter((player) => player.participantKey !== endWinnerKey)
                    .forEach((player) => pulseDamage(player.participantKey));
                enqueueMutation({ type: 'last_standing', winnerKey: endWinnerKey });
            }
            const finalizedGame = journal.getSnapshot().record ?? liveGame;
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
            cancelScheduledSync();
            const durationSeconds = getGameDurationSeconds(liveGame.started_at, pending.endedAt);
            onEvent({ type: 'finalizing', record: finalizedGame, durationSeconds });
            if (!await journal.archive(pending, false) || !command.isCurrent())
                return;
            flushArchivedOutbox();
            hapticSuccess();
            showToast(`${endIsDraw ? copy('liveGameSavedDraw') : copy('liveGameSaved')} · ${formatGameDuration(durationSeconds)}`);
            onEvent({ type: 'completed' });
        }
        catch {
            if (!command.isCurrent())
                return;
            void saveJournal();
            showToast(copy('liveGameSaveFailed'));
        }
        finally {
            if (command.isCurrent()) {
                setEndingGame(false);
                onEvent({ type: 'end-finished' });
            }
            command.release();
        }
    };
    const preparePreviousPod = useCallback(() => {
        const previous = completedGame;
        if (!previous)
            return null;
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
        if (!user || !isLiveScopeCurrent())
            return;
        const command = beginLiveCommand();
        if (!command)
            return;
        try {
            const previous = preparePreviousPod();
            if (!previous)
                return;
            const keys = previous.state.players.map((player) => player.participantKey);
            const record = createLiveGameRound({
                id: Crypto.randomUUID(), groupId, actorId: user.id, startedAt: new Date().toISOString(),
                startingLife: previous.starting_life, layoutVariant: previous.state.layoutVariant ?? 'classic',
                seats: previous.state.players, random: Math.random,
            });
            if (!journal.start(record))
                return;
            revealStartingPlayer(record.state.startingPlayerKey ?? null, keys);
            onEvent({ type: 'rematch-prepared' });
            await saveJournal();
            if (!command.isCurrent())
                return;
            void syncJournal();
        }
        finally {
            command.release();
        }
    }, [journal, beginLiveCommand, groupId, isLiveScopeCurrent, preparePreviousPod, revealStartingPlayer, saveJournal, syncJournal, user, onEvent]);
    const handleRematchReselect = useCallback(() => {
        preparePreviousPod();
        onEvent({ type: 'rematch-prepared' });
    }, [preparePreviousPod, onEvent]);
    useLayoutEffect(() => { setStarting(false); setEndingGame(false); setDiscardingGame(false); }, [epoch]);
    return { starting, endingGame, discardingGame, handleStart, handleDiscardGame, handleEndGame, handleRematchSameDecks, handleRematchReselect };
}
