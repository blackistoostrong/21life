'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadWebLiveGameSetup, saveWebLiveGameSetup, type WebLiveGameSetup, type WebLiveGameSeatSetup } from '@/lib/live-game-setup';
import type { TableLayoutVariant } from '@/lib/live-game-table-layout';
import type { ParticipantKey } from '@/lib/participant-keys';
import type { WebTrackerDeck, WebTrackerParticipant } from '@/lib/types/web-tracker';

type CreatedDeck = { id: string; name: string; commander: string; commander_image: string | null };

/** Owns setup draft/storage, occasional catalog additions and selected-art preloading. */
export function useWebTrackerSetup(groupId: string, userId: string, catalogParticipants: WebTrackerParticipant[]) {
  const [occasionalCreationRequests, setOccasionalCreationRequests] = useState<Record<string, boolean>>({});
  const occasionalCreationBusy = Object.values(occasionalCreationRequests).some(Boolean);
  const [occasionalDecks, setOccasionalDecks] = useState<Record<string, WebTrackerDeck[]>>({});
  const participants = useMemo(() => catalogParticipants.map(participant => ({ ...participant,
    decks: [...participant.decks, ...(occasionalDecks[participant.key] || []).filter(deck => !participant.decks.some(item => item.id === deck.id))],
  })), [catalogParticipants, occasionalDecks]);
  const initialSetup = useMemo(() => loadWebLiveGameSetup(groupId, userId), [groupId, userId]);
  const [playerCount, setPlayerCount] = useState(initialSetup.playerCount);
  const [layoutVariant, setLayoutVariant] = useState<TableLayoutVariant>(initialSetup.layoutVariant);
  const [startingLife, setStartingLife] = useState(initialSetup.startingLife);
  const [seats, setSeats] = useState<WebLiveGameSeatSetup[]>(initialSetup.seats);
  const [setupStep, setSetupStep] = useState(0);
  const [setupSeatIndex, setSetupSeatIndex] = useState(0);
  const [setupDeckSearch, setSetupDeckSearch] = useState('');

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
  // Preserve thrown storage errors: the game controller exposes durability feedback.
  const persistSetup = useCallback((value: WebLiveGameSetup) => {
    saveWebLiveGameSetup(groupId, userId, value);
  }, [groupId, userId]);
  return { participants, occasionalCreationBusy, playerCount, layoutVariant, setLayoutVariant,
    startingLife, setStartingLife, seats, setSeats, setupStep, setSetupStep,
    setupSeatIndex, setSetupSeatIndex, setupDeckSearch, setSetupDeckSearch,
    changePlayerCount, updateSeatParticipant, setOccasionalBusy, registerOccasionalDeck,
    restoreSetup, persistSetup };
}
export type WebTrackerSetupController = ReturnType<typeof useWebTrackerSetup>;
