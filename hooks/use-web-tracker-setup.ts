'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { loadWebLiveGameSetup, saveWebLiveGameSetup, type WebLiveGameSetup, type WebLiveGameSeatSetup } from '@/lib/live-game-setup';
import type { TableLayoutVariant } from '@/lib/live-game-table-layout';
import type {PreparedTablePreset} from '../packages/data/table-preset-references';
import type {TablePresetReference} from '../packages/domain/table-presets';
import type { ParticipantKey } from '@/lib/participant-keys';
import type { WebTrackerDeck, WebTrackerParticipant } from '@/lib/types/web-tracker';

type CreatedDeck = { id: string; name: string; commander: string; commander_image: string | null };

/** Owns setup draft/storage, occasional catalog additions and selected-art preloading. */
export function useWebTrackerSetup(groupId: string, userId: string, catalogParticipants: WebTrackerParticipant[]) {
  const [occasionalCreationRequests, setOccasionalCreationRequests] = useState<Record<string, boolean>>({});
  const occasionalCreationBusy = Object.values(occasionalCreationRequests).some(Boolean);
  const [occasionalDecks, setOccasionalDecks] = useState<Record<string, WebTrackerDeck[]>>({});
  const contextKey = `${userId}:${groupId}`;
  const [presetProjection, setPresetProjection] = useState<{
    key: string; references: readonly TablePresetReference[]; revision: number;
  }>(() => ({key: contextKey, references: [], revision: 0}));
  const presetReferences = useMemo(() => presetProjection.key === contextKey ? presetProjection.references : [],
    [contextKey, presetProjection]);
  const participants = useMemo(() => {
    const rows = [...catalogParticipants];
    for (const reference of presetReferences) {
      if (rows.some(row => row.key === reference.participantKey)) continue;
      const isGuest = reference.participantKey.startsWith('guest:');
      rows.push({key: reference.participantKey, displayName: reference.displayName, isGuest,
        userId: isGuest ? null : reference.participantKey.slice(5),
        guestId: isGuest ? reference.participantKey.slice(6) : null, decks: []});
    }
    return rows.map(participant => {
      const decks = [...participant.decks, ...(occasionalDecks[participant.key] || [])
        .filter(deck => !participant.decks.some(item => item.id === deck.id))];
      const reference = presetReferences.find(reference => reference.participantKey === participant.key);
      if (reference) {
        const index = decks.findIndex(deck => deck.id === reference.deckId);
        const option: WebTrackerDeck = {
          id: reference.deckId, name: reference.deckName, commander: reference.commander,
          commanderImage: reference.commanderImage, isFavorite: decks[index]?.isFavorite ?? false,
          isOccasional: reference.deckKind === 'occasional',
        };
        if (index >= 0) decks[index] = option; else decks.push(option);
      }
      return {...participant, displayName: reference?.displayName ?? participant.displayName, decks};
    });
  }, [catalogParticipants, occasionalDecks, presetReferences]);
  const initialSetup = useMemo(() => loadWebLiveGameSetup(groupId, userId), [groupId, userId]);
  const [playerCount, setPlayerCount] = useState(initialSetup.playerCount);
  const [layoutVariant, setLayoutVariant] = useState<TableLayoutVariant>(initialSetup.layoutVariant);
  const [startingLife, setStartingLife] = useState(initialSetup.startingLife);
  const [seats, setSeats] = useState<WebLiveGameSeatSetup[]>(initialSetup.seats);
  const [setupStep, setSetupStep] = useState(0);
  const [setupSeatIndex, setSetupSeatIndex] = useState(0);
  const [setupDeckSearch, setSetupDeckSearch] = useState('');
  const [setupReadyKey, setSetupReadyKey] = useState(contextKey);
  useLayoutEffect(() => {
    if (setupReadyKey === contextKey) return;
    setPlayerCount(initialSetup.playerCount);
    setLayoutVariant(initialSetup.layoutVariant);
    setStartingLife(initialSetup.startingLife);
    setSeats(initialSetup.seats);
    setSetupStep(0);
    setSetupSeatIndex(0);
    setSetupDeckSearch('');
    setOccasionalDecks({});
    setOccasionalCreationRequests({});
    setPresetProjection({key: contextKey, references: [], revision: 0});
    setSetupReadyKey(contextKey);
  }, [contextKey, initialSetup, setupReadyKey]);


  useEffect(() => {
    seats.forEach((seat) => {
      if (!seat.participantKey || !seat.deckId) return;
      const deck = participants.find((participant) => participant.key === seat.participantKey)
        ?.decks.find((entry) => entry.id === seat.deckId);
      if (deck?.commanderImage) {
        const preload = new Image();
        preload.src = deck.commanderImage;
      }
    });
  }, [participants, seats]);

  const changePlayerCount = (next: number) => {
    if (occasionalCreationBusy) return;
    setPlayerCount(next);
    setSeats((current) => Array.from({ length: next }, (_, index) => (
      current[index] ?? { participantKey: null, deckId: null }
    )));
  };

  const updateSeatParticipant = (index: number, key: ParticipantKey | null) => {
    if (occasionalCreationBusy) return;
    setSetupDeckSearch('');
    setSeats((current) => current.map((seat, seatIndex) => {
      if (seatIndex !== index) return seat;
      const participant = participants.find((entry) => entry.key === key);
      const previous = initialSetup.seats.find((entry) => entry.participantKey === key)?.deckId;
      const deckId = participant?.decks.some((deck) => deck.id === previous && !deck.isOccasional)
        ? previous!
        : participant?.decks.find(deck => !deck.isOccasional)?.id ?? null;
      return { participantKey: key, deckId };
    }));
  };

  const setOccasionalBusy = (key: ParticipantKey, busy: boolean) => {
    setOccasionalCreationRequests(current => ({ ...current, [key]: busy }));
  };
  const registerOccasionalDeck = (target: number, key: ParticipantKey, deck: CreatedDeck) => {
    setOccasionalDecks(current => ({ ...current, [key]: [...(current[key] || []), {
      id: deck.id, name: deck.name, commander: deck.commander, commanderImage: deck.commander_image,
      isFavorite: false, isOccasional: true,
    }] }));
    setSeats(current => current.map((seat, index) => index === target && seat.participantKey === key ? { ...seat, deckId: deck.id } : seat));
  };
  const restoreSetup = (value: WebLiveGameSetup) => {
    setPlayerCount(value.playerCount);
    setLayoutVariant(value.layoutVariant);
    setStartingLife(value.startingLife);
    setSeats(value.seats);
  };
  const applyPreset = (prepared: PreparedTablePreset) => {
    const draft = prepared.draft;
    restoreSetup({playerCount: draft.playerCount, layoutVariant: draft.layoutVariant, startingLife: draft.startingLife,
      seats: draft.seats.map(({participantKey, deckId}) => ({participantKey, deckId}))});
    setPresetProjection(current => ({key: contextKey, references: prepared.references,
      revision: current.key === contextKey ? current.revision + 1 : 1}));
    setSetupStep(3);
    setSetupSeatIndex(0);
    setSetupDeckSearch('');
  };
  const presetMissingReferences = presetProjection.key === contextKey && presetProjection.revision > 0
    ? seats.filter(seat => !seat.participantKey || !seat.deckId).length : 0;
  // Preserve thrown storage errors: the game controller exposes durability feedback.
  const persistSetup = useCallback((value: WebLiveGameSetup) => {
    saveWebLiveGameSetup(groupId, userId, value);
  }, [groupId, userId]);
  return { participants, occasionalCreationBusy, playerCount, layoutVariant, setLayoutVariant,
    startingLife, setStartingLife, seats, setSeats, setupStep, setSetupStep,
    setupSeatIndex, setSetupSeatIndex, setupDeckSearch, setSetupDeckSearch,
    changePlayerCount, updateSeatParticipant, setOccasionalBusy, registerOccasionalDeck,
    restoreSetup, persistSetup, applyPreset, presetMissingReferences, setupReadyKey };
}
export type WebTrackerSetupController = ReturnType<typeof useWebTrackerSetup>;
