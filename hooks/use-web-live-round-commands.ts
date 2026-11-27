'use client';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import {createLiveGameReferenceReader} from '@/lib/live-game-reference-reader';
import {readLiveGameRoundReferences} from '../packages/data/live-game-round-references';
import {liveGameReferenceStamp,reconcileLiveGameReferences} from '../packages/domain/live-game-reference-validation';
import { createLiveGameRound } from '@/lib/live-game-round';
import { createWebLiveCommandClient } from '@/lib/web-live-command-client';
import { fetchBusyLiveGameParticipantKeys } from '@/lib/live-game-service';
import { isValidLiveGameResult, type LiveGameMutation, type LiveGameRecord, type WinCondition } from '@/lib/live-game';
import type { ParticipantKey } from '@/lib/participant-keys';
import type { TableLayoutVariant } from '@/lib/live-game-table-layout';
import type { WebLiveGameSetup, WebLiveGameSeatSetup } from '@/lib/live-game-setup';
import type { WebTrackerSetupController } from '@/hooks/use-web-tracker-setup';
import type { useWebLiveSession } from '@/hooks/use-web-live-session';
type Session = Pick<ReturnType<typeof useWebLiveSession>, 'journal' | 'record' | 'flush' | 'beginRoundCommand'>;
type Setup = Pick<WebTrackerSetupController, 'participants' | 'occasionalCreationBusy' | 'playerCount' | 'layoutVariant' | 'startingLife' | 'seats' | 'persistSetup'>;
type Ports = {
    setup: Setup;
    completedRecord: LiveGameRecord | null;
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
        onSetupRequired: (setup: WebLiveGameSetup) => void;
    };
    enqueue: (mutation: LiveGameMutation) => void;
};
function secureRandom() {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0]! / 4294967296;
}
/** Coordinates existing start/rematch and terminal commands through scoped session actions. */
export function useWebLiveRoundCommands(groupId: string, userId: string, { setup, completedRecord, session, selection, presentation, enqueue }: Ports) {
    const { copy } = useLanguage();
    const { toast } = useToast();
    const router = useRouter();
    const { participants, occasionalCreationBusy, playerCount, layoutVariant, startingLife, seats, persistSetup } = setup;
    const { journal, record, flush, beginRoundCommand } = session;
    const { isDraw, winnerKey, winCondition, duration } = selection;
    const { enterTrackerLandscape, restoreDefaultTrackerDisplay, runRoulette, onRoundCreated, onSetupRequired } = presentation;
    const persist = journal.persist;
    const [starting, setStarting] = useState(false);
    const [ending, setEnding] = useState(false);
    const opening = useMemo(()=>({groupId,userId,recordId:completedRecord?.id}),[groupId,userId,completedRecord?.id]);
    const openingRef = useRef<typeof opening|null>(null);
    const requestRef = useRef<{opening:typeof opening;controller:AbortController}|null>(null);
    const participantsRef = useRef(participants);
    useLayoutEffect(()=>{participantsRef.current=participants;},[participants]);
    useLayoutEffect(()=>{
        openingRef.current=opening;
        return()=>{
            if(openingRef.current===opening)openingRef.current=null;
            if(requestRef.current?.opening===opening){requestRef.current.controller.abort();requestRef.current=null;}
        };
    },[opening]);
    const startGame = async (override?: {
        playerCount: number;
        layoutVariant: TableLayoutVariant;
        startingLife: number;
        seats: WebLiveGameSeatSetup[];
    }, previous?: LiveGameRecord) => {
        if(previous && (previous.id!==opening.recordId || previous.group_id!==groupId || openingRef.current!==opening))return;
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
        const controller = new AbortController();
        const request = {opening,controller};
        if(previous)requestRef.current=request;
        const abort = ()=>controller.abort();
        job.signal.addEventListener('abort',abort,{once:true});
        if(job.signal.aborted)controller.abort();
        let committed = false;
        const active = ()=>job.active() && (!previous || committed || (openingRef.current===opening&&!controller.signal.aborted));
        try {
            const keys = selected.map((seat) => seat.participantKey!) as ParticipantKey[];
            let resolved = selected.map(seat=>{
                const participant=participants.find(entry=>entry.key===seat.participantKey);
                const deck=participant?.decks.find(entry=>entry.id===seat.deckId);
                return participant&&deck?{participantKey:participant.key,deckId:deck.id,displayName:participant.displayName,
                    commander:deck.commander,commanderImage:deck.commanderImage}:null;
            });
            if (navigator.onLine) {
                const { client } = await createWebLiveCommandClient(userId, controller.signal);
                if (!active())return;
                const busy = await fetchBusyLiveGameParticipantKeys(client, groupId, keys,
                    previous?{excludeLiveGameId:previous.id,signal:controller.signal}:undefined);
                if (!active())return;
                if (busy.length)
                    throw new Error(copy({ it: 'Uno dei giocatori è già in una partita attiva.', en: 'A player is already in another active game.' }));
                if(previous){
                    for(let attempt=0;attempt<2;attempt++){
                        const stamp=liveGameReferenceStamp(selected,participantsRef.current);
                        const result=await readLiveGameRoundReferences(createLiveGameReferenceReader(client),
                            {groupId,actorId:userId,seats:selected},controller.signal);
                        if(!active())return;
                        if(result.kind==='denied'){
                            router.replace(`/table/${groupId}`);
                            throw new Error(copy({it:'Non hai più accesso a questo gruppo.',en:'You no longer have access to this group.'}));
                        }
                        if(stamp!==liveGameReferenceStamp(selected,participantsRef.current)){
                            if(attempt===0)continue;
                            throw new Error(copy({it:'I giocatori o i mazzi sono cambiati. Riprova.',en:'Players or decks changed. Try again.'}));
                        }
                        const plan=reconcileLiveGameReferences(selected,result.participants,{allowArchived:true});
                        if(plan.issues.length){
                            onSetupRequired({playerCount:nextPlayerCount,layoutVariant:nextLayoutVariant,startingLife:nextStartingLife,seats:plan.seats});
                            throw new Error(copy({it:'Alcuni giocatori o mazzi non sono più disponibili. Controlla i posti prima di ripartire.',en:'Some players or decks are no longer available. Check the seats before starting again.'}));
                        }
                        resolved=plan.resolved;break;
                    }
                }
            }else if(previous){
                resolved=[...previous.state.players].sort((a,b)=>a.slot-b.slot);
            }
            if(!active())return;
            if(resolved.some(seat=>!seat))
                throw new Error(copy({it:'Controlla i giocatori e i mazzi selezionati.',en:'Check the selected players and decks.'}));
            const created = createLiveGameRound({
                id: crypto.randomUUID(), groupId, actorId: userId, startedAt: new Date().toISOString(),
                startingLife: nextStartingLife, layoutVariant: nextLayoutVariant, random: secureRandom,
                seats: resolved.filter(seat=>seat!==null),
            });
            if (!journal.start(created))
                throw new Error(copy({ it: 'La partita precedente ha ancora operazioni da sincronizzare.', en: 'The previous game still has pending operations to sync.' }));
            committed=true;
            if(requestRef.current===request)requestRef.current=null;
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
            if (!active())
                return;
            restoreDefaultTrackerDisplay();
            toast({ title: copy({ it: 'Partita non avviata', en: 'Game not started' }), description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
        }
        finally {
            job.signal.removeEventListener('abort',abort);
            if(requestRef.current===request)requestRef.current=null;
            controller.abort();
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
