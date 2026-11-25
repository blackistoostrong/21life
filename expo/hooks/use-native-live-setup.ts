import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { useArena } from '@/hooks/use-arena';
import { restoreSetupDecks } from '@/components/live-game/restore-setup-decks';
import type { SetupParticipant } from '@/components/live-game/live-game-configurator';
import { toDeckOption } from '@/components/table/match-participant-row';
import { getLastDeckSelectionForParticipant } from '@/lib/arena-participants';
import { getPreferredDeckId } from '@/lib/arena-deck-selection';
import { toGuestParticipantKey, toUserParticipantKey, type ParticipantKey } from '@/lib/participant-keys';
import { getProfileDisplayName } from '@/lib/profile-display';
import { prefetchCommanderNames, prefetchDeckImageUrls } from '@/lib/deck-image-cache';
import { createDefaultLiveGameSetup, clearLiveGameSeats, loadLiveGameSetup, type LiveGameSeatSetup } from '@/lib/live-game-setup';
import type { TableLayoutVariant } from '@/lib/live-game-table-layout';
import type { MemberDeck } from '@/lib/types/arena';
import { supabase } from '@/lib/supabase';

type LifePreset = '20' | '25' | '30' | '40' | '60' | 'custom';
const LIFE_PRESETS: LifePreset[] = ['20', '25', '30', '40', '60'];
type Catalog = Pick<ReturnType<typeof useArena>, 'members' | 'guests' | 'decks' | 'matches' | 'loading'>;
/** Owns the native live setup draft, catalog projection and persisted restoration. */
export function useNativeLiveSetup(groupId: string, user: { id: string } | null, {members, guests, decks, matches, loading}: Catalog) {
  const [selectedKeys, setSelectedKeys] = useState<ParticipantKey[]>([]);
  const [participantDecks, setParticipantDecks] = useState<Record<string, string>>({});
  const [playerCount, setPlayerCount] = useState(4);
  const [layoutVariant, setLayoutVariant] = useState<TableLayoutVariant>('classic');
  const [seatSetups, setSeatSetups] = useState<LiveGameSeatSetup[]>(
    createDefaultLiveGameSetup().seats,
  );
  const [lifePreset, setLifePreset] = useState<LifePreset>('40');
  const [customLife, setCustomLife] = useState('40');
  const [setupReadyKey, setSetupReadyKey] = useState<string | null>(null);
  const [setupRestoreError, setSetupRestoreError] = useState(false);
  const [setupRetry, setSetupRetry] = useState(0);
  const setupHydratingRef = useRef(false);
  const setupHydratedRef = useRef<string | null>(null);
  const startingLife = useMemo(() => {
    if (lifePreset === 'custom') {
      const parsed = Number.parseInt(customLife, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
    }
    return Number.parseInt(lifePreset, 10);
  }, [customLife, lifePreset]);
  const [occasionalDecks, setOccasionalDecks] = useState<MemberDeck[]>([]);
  const decksByUser = useMemo(() => {
    const map = new Map<string, MemberDeck[]>();
    [...decks, ...occasionalDecks].forEach((deck) => {
      const current = map.get(deck.user_id) || [];
      current.push(deck);
      map.set(deck.user_id, current);
    });
    return map;
  }, [decks, occasionalDecks]);
  const getDeckOptions = useCallback((key: ParticipantKey) => {
    if (key.startsWith('guest:')) {
      const guestId = key.slice(6);
      const guestDecks = guests.find((guest) => guest.id === guestId)?.arena_guest_decks || [];
      return guestDecks.map(toDeckOption);
    }
    return (decksByUser.get(key.slice(5)) || []).map(toDeckOption);
  }, [decksByUser, guests]);
  const setupParticipants = useMemo<SetupParticipant[]>(() => [
    ...members.map((member) => {
      const key = toUserParticipantKey(member.id);
      const options = getDeckOptions(key);
      return {
        key,
        name: getProfileDisplayName(member),
        decks: options,
        preferredDeckId: getPreferredDeckId(
          options,
          getLastDeckSelectionForParticipant(key, matches),
        ),
      };
    }),
    ...guests.map((guest) => {
      const key = toGuestParticipantKey(guest.id);
      const options = getDeckOptions(key);
      return {
        key,
        name: guest.display_name,
        decks: options,
        preferredDeckId: getPreferredDeckId(
          options,
          getLastDeckSelectionForParticipant(key, matches),
        ),
      };
    }),
  ], [getDeckOptions, guests, matches, members]);
  const applySeatSetups = useCallback((nextSeats: LiveGameSeatSetup[]) => {
    setSeatSetups(nextSeats);
    const assigned = nextSeats.filter(
      (seat): seat is { participantKey: ParticipantKey; deckId: string | null } => Boolean(seat.participantKey),
    );
    setSelectedKeys(assigned.map((seat) => seat.participantKey));
    setParticipantDecks(Object.fromEntries(
      assigned.filter((seat) => seat.deckId).map((seat) => [seat.participantKey, seat.deckId!]),
    ));
  }, []);
  const applyStartingLife = useCallback((value: number) => {
    const preset = String(value) as LifePreset;
    if (LIFE_PRESETS.includes(preset)) {
      setLifePreset(preset);
      setCustomLife(String(value));
    } else {
      setLifePreset('custom');
      setCustomLife(String(value));
    }
  }, []);
  const handlePlayerCountChange = useCallback((count: number) => {
    setPlayerCount(count);
    applySeatSetups(Array.from({ length: count }, (_, index) => (
      seatSetups[index] ?? { participantKey: null, deckId: null }
    )));
  }, [applySeatSetups, seatSetups]);
  const handleAssignSeat = useCallback((
    index: number,
    participantKey: ParticipantKey | null,
    deckId: string | null,
  ) => {
    const next = seatSetups.map((seat, seatIndex) => {
      if (seatIndex === index) return { participantKey, deckId };
      if (participantKey && seat.participantKey === participantKey) {
        return { participantKey: null, deckId: null };
      }
      return seat;
    });
    applySeatSetups(next);
  }, [applySeatSetups, seatSetups]);
  const resetSetup = useCallback(() => {
    applySeatSetups(clearLiveGameSeats(seatSetups));
  }, [applySeatSetups, seatSetups]);
  useEffect(() => {
    const selectedDecks = seatSetups.flatMap((seat) => {
      if (!seat.participantKey || !seat.deckId) return [];
      const deck = getDeckOptions(seat.participantKey).find((option) => option.id === seat.deckId);
      return deck ? [deck] : [];
    });
    if (selectedDecks.length === 0) return;
    void prefetchDeckImageUrls(selectedDecks.map((deck) => deck.commander_image), { background: true });
    void prefetchCommanderNames(selectedDecks.map((deck) => deck.commander), { background: true });
  }, [getDeckOptions, seatSetups]);
  useEffect(() => {
    if (!groupId || !user || loading || setupHydratingRef.current || setupHydratedRef.current === `${user.id}:${groupId}`) return;
    setupHydratingRef.current = true;
    setSetupRestoreError(false);
    void loadLiveGameSetup(groupId, user.id).then(async (saved) => {
      if (!saved) { setupHydratedRef.current = `${user.id}:${groupId}`; setSetupReadyKey(`${user.id}:${groupId}`); return; }
      const savedDeckIds = saved.seats.filter(seat => seat.participantKey?.startsWith('user:') && seat.deckId).map(seat => seat.deckId!);
      let restoredDecks: MemberDeck[] = [];
      if (savedDeckIds.length) {
        restoredDecks = await restoreSetupDecks(supabase, groupId, savedDeckIds);
        setOccasionalDecks(current => [...current.filter(deck => !restoredDecks.some(restored => restored.id === deck.id)), ...restoredDecks]);
      }
      const participantMap = new Map(setupParticipants.map((participant) => [participant.key, participant]));
      const validatedSeats = saved.seats.map((seat) => {
        if (!seat.participantKey) return { participantKey: null, deckId: null };
        const participant = participantMap.get(seat.participantKey);
        if (!participant) return { participantKey: null, deckId: null };
        const validDeck = participant.decks.some((deck) => deck.id === seat.deckId)
          || restoredDecks.some(deck => deck.id === seat.deckId && `user:${deck.user_id}` === seat.participantKey);
        const fallbackDeck = participant.preferredDeckId;
        return {
          participantKey: seat.participantKey,
          deckId: validDeck ? seat.deckId : fallbackDeck,
        };
      });
      setPlayerCount(saved.playerCount);
      setLayoutVariant(saved.layoutVariant);
      applyStartingLife(saved.startingLife);
      applySeatSetups(validatedSeats);
      setupHydratedRef.current = `${user.id}:${groupId}`;
      setSetupReadyKey(`${user.id}:${groupId}`);
    }).catch(() => { setSetupRestoreError(true); }).finally(() => { setupHydratingRef.current = false; });
  }, [applySeatSetups, applyStartingLife, groupId, loading, setupParticipants, setupRetry, user]);
 return { selectedKeys, setSelectedKeys, participantDecks, setParticipantDecks, playerCount, setPlayerCount, layoutVariant, setLayoutVariant, seatSetups, setSeatSetups, setupReadyKey, setupRestoreError, setSetupRetry, startingLife, setOccasionalDecks, getDeckOptions, setupParticipants, applySeatSetups, applyStartingLife, handlePlayerCountChange, handleAssignSeat, resetSetup };
}
