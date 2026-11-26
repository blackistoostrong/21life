'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { createLiveGameRound } from '@/lib/live-game-round';
import { createWebLiveCommandClient } from '@/lib/web-live-command-client';
import { fetchBusyLiveGameParticipantKeys } from '@/lib/live-game-service';
import { isValidLiveGameResult, type LiveGameMutation, type WinCondition } from '@/lib/live-game';
import type { ParticipantKey } from '@/lib/participant-keys';
import type { TableLayoutVariant } from '@/lib/live-game-table-layout';
import type { WebLiveGameSeatSetup } from '@/lib/live-game-setup';
import type { WebTrackerSetupController } from '@/hooks/use-web-tracker-setup';
import type { useWebLiveSession } from '@/hooks/use-web-live-session';
type Session = Pick<ReturnType<typeof useWebLiveSession>, 'journal' | 'record' | 'flush' | 'beginRoundCommand'>;
type Setup = Pick<WebTrackerSetupController, 'participants' | 'occasionalCreationBusy' | 'playerCount' | 'layoutVariant' | 'startingLife' | 'seats' | 'persistSetup'>;
type Ports = {
    setup: Setup;
    session: Session;
    selection: {
        isDraw: boolean;
        winnerKey: ParticipantKey | '';
        winCondition: WinCondition | null;
        duration: string;
    };
    presentation: {
        enterTrackerLandscape: () => void;
        restoreDefaultTrackerDisplay: () => void;
        runRoulette: (pool: ParticipantKey[], winner?: ParticipantKey) => void;
        onRoundCreated: () => void;
    };
    enqueue: (mutation: LiveGameMutation) => void;
};
function secureRandom() {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0]! / 4294967296;
}
/** Coordinates existing start/rematch and terminal commands through scoped session actions. */
export function useWebLiveRoundCommands(groupId: string, userId: string, { setup, session, selection, presentation, enqueue }: Ports) {
    const { copy } = useLanguage();
    const { toast } = useToast();
    const router = useRouter();
    const { participants, occasionalCreationBusy, playerCount, layoutVariant, startingLife, seats, persistSetup } = setup;
    const { journal, record, flush, beginRoundCommand } = session;
    const { isDraw, winnerKey, winCondition, duration } = selection;
    const { enterTrackerLandscape, restoreDefaultTrackerDisplay, runRoulette, onRoundCreated } = presentation;
    const persist = journal.persist;
    const [starting, setStarting] = useState(false);
    const [ending, setEnding] = useState(false);
    const startGame = async (override?: {
        playerCount: number;
        layoutVariant: TableLayoutVariant;
        startingLife: number;
        seats: WebLiveGameSeatSetup[];
    }) => {
        const nextPlayerCount = override?.playerCount ?? playerCount;
        const nextLayoutVariant = override?.layoutVariant ?? layoutVariant;
        const nextStartingLife = override?.startingLife ?? startingLife;
        if (occasionalCreationBusy)
            return;
        const nextSeats = override?.seats ?? seats;
        const selected = nextSeats.filter((seat) => seat.participantKey && seat.deckId);
        if (selected.length !== nextPlayerCount || new Set(selected.map((seat) => seat.participantKey)).size !== nextPlayerCount) {
            toast({ title: copy({ it: 'Completa tutti i posti', en: 'Complete every seat' }), variant: 'destructive' });
            return;
        }
        const job = beginRoundCommand();
        if (!job)
            return;
        enterTrackerLandscape();
        setStarting(true);
        try {
            const keys = selected.map((seat) => seat.participantKey!) as ParticipantKey[];
            if (navigator.onLine) {
                const { client } = await createWebLiveCommandClient(userId, job.signal);
                if (!job.active())
                    return;
                const busy = await fetchBusyLiveGameParticipantKeys(client, groupId, keys);
                if (!job.active())
                    return;
                if (busy.length)
                    throw new Error(copy({ it: 'Uno dei giocatori è già in una partita attiva.', en: 'A player is already in another active game.' }));
            }
            const created = createLiveGameRound({
                id: crypto.randomUUID(), groupId, actorId: userId, startedAt: new Date().toISOString(),
                startingLife: nextStartingLife, layoutVariant: nextLayoutVariant, random: secureRandom,
                seats: selected.map(seat => {
                    const participant = participants.find(entry => entry.key === seat.participantKey)!;
                    const deck = participant.decks.find(entry => entry.id === seat.deckId)!;
                    return { participantKey: participant.key, deckId: deck.id, displayName: participant.displayName,
                        commander: deck.commander, commanderImage: deck.commanderImage };
                }),
            });
            if (!journal.start(created))
                throw new Error(copy({ it: 'La partita precedente ha ancora operazioni da sincronizzare.', en: 'The previous game still has pending operations to sync.' }));
            onRoundCreated();
            try {
                persistSetup({
                    playerCount: nextPlayerCount,
                    layoutVariant: nextLayoutVariant,
                    startingLife: nextStartingLife,
                    seats: nextSeats,
                });
            }
            catch {
                journal.markUnavailable();
            }
            persist();
            runRoulette(keys, created.state.startingPlayerKey!);
            void flush();
        }
        catch (error) {
            if (!job.active())
                return;
            restoreDefaultTrackerDisplay();
            toast({ title: copy({ it: 'Partita non avviata', en: 'Game not started' }), description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
        }
        finally {
            if (job.active())
                setStarting(false);
            job.finish();
        }
    };
    const finishGame = async () => {
        if (!record)
            return;
        const result = {
            winnerKey: isDraw ? null : winnerKey || null,
            isDraw,
            winCondition: isDraw ? null : winCondition,
        };
        if (!isValidLiveGameResult(record.state, result)) {
            toast({ title: copy({ it: 'Seleziona vincitore e condizione di vittoria.', en: 'Select a winner and win condition.' }), variant: 'destructive' });
            return;
        }
        const job = beginRoundCommand();
        if (!job)
            return;
        try {
            if (!isDraw && result.winCondition === 'last_standing' && result.winnerKey) {
                enqueue({ type: 'last_standing', winnerKey: result.winnerKey });
            }
            const finalRecord = journal.getSnapshot().record ?? record;
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
            journal.requestFinalization({
                winnerKey: result.winnerKey,
                isDraw,
                winCondition: result.winCondition,
                endedAt: new Date().toISOString(),
                players,
            });
            setEnding(true);
            const saved = await flush();
            if (!job.active())
                return;
            if (saved) {
                toast({ title: copy({ it: `Partita salvata · ${duration}`, en: `Game saved · ${duration}` }) });
            }
            else {
                toast({ title: copy({ it: 'Salvataggio in attesa di connessione', en: 'Waiting for connection to save' }), variant: 'destructive' });
            }
        }
        finally {
            if (job.active())
                setEnding(false);
            job.finish();
        }
    };
    const cancelGame = async () => {
        if (!record)
            return;
        const job = beginRoundCommand();
        if (!job)
            return;
        try {
            journal.requestCancellation();
            const cancelled = await flush();
            if (job.active() && cancelled) {
                router.replace(`/table/${groupId}`);
            }
        }
        finally {
            job.finish();
        }
    };
    return { starting, ending, startGame, finishGame, cancelGame };
}
