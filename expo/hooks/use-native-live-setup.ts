import type {PreparedTablePreset} from '../../packages/data/table-preset-references';
import type {TablePresetReference} from '../../packages/domain/table-presets';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { useLiveGameCommandScope } from './use-live-game-command-scope';
import type { useArena } from '@/hooks/use-arena';
import { restoreSetupDecks } from '@/lib/live-game-setup-restore';
import type { SetupParticipant } from '@/components/live-game/live-game-configurator';
import { toDeckOption } from '@/lib/arena-deck-option';
import { getLastDeckSelectionForParticipant } from '@/lib/arena-participants';
import { getPreferredDeckId } from '@/lib/arena-deck-selection';
import { toGuestParticipantKey, toUserParticipantKey, type ParticipantKey } from '@/lib/participant-keys';
import { getProfileDisplayName } from '@/lib/profile-display';
import { prefetchCommanderNames, prefetchDeckImageUrls } from '@/lib/deck-image-cache';
import { createDefaultLiveGameSetup, clearLiveGameSeats, loadLiveGameSetup, type LiveGameSeatSetup } from '@/lib/live-game-setup';
import type { TableLayoutVariant } from '@/lib/live-game-table-layout';
import type { MemberDeck } from '@/lib/types/arena';

type LifePreset = '20' | '25' | '30' | '40' | '60' | 'custom';
const LIFE_PRESETS: LifePreset[] = ['20', '25', '30', '40', '60'];
type Catalog = Pick<ReturnType<typeof useArena>, 'members' | 'guests' | 'decks' | 'matches' | 'loading'>;
/** Owns the native live setup draft, catalog projection and persisted restoration. */
export function useNativeLiveSetup(groupId: string, user: { id: string } | null,
  {members, guests, decks, matches, loading}: Catalog,
  {epoch, isCurrent, bindClient}: Pick<ReturnType<typeof useLiveGameCommandScope>, 'epoch' | 'isCurrent' | 'bindClient'>) {
  const userId = user?.id;
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
  const setupHydratingRef = useRef<{ controller: AbortController } | null>(null);
  const setupHydratedRef = useRef<string | null>(null);
  const startingLife = useMemo(() => {
    if (lifePreset === 'custom') {
      const parsed = Number.parseInt(customLife, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
    }
    return Number.parseInt(lifePreset, 10);
  }, [customLife, lifePreset]);
  const [occasionalDecks, setOccasionalDecks] = useState<MemberDeck[]>([]);
  const contextKey = `${userId}:${groupId}`;
  const [presetProjection, setPresetProjection] = useState<{
    key: string; references: readonly TablePresetReference[]; revision: number;
  }>(() => ({key: contextKey, references: [], revision: 0}));
  const presetReferences = useMemo(() => presetProjection.key === contextKey ? presetProjection.references : [],
    [contextKey, presetProjection]);
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
    const existing = key.startsWith('guest:')
      ? (guests.find(guest => guest.id === key.slice(6))?.arena_guest_decks || []).map(toDeckOption)
      : (decksByUser.get(key.slice(5)) || []).map(toDeckOption);
    const options = new Map<string, ReturnType<typeof toDeckOption>>();
    for (const option of existing) if (!options.has(option.id)) options.set(option.id, option);
    const reference = presetReferences.find(reference => reference.participantKey === key);
    if (reference) {
      options.set(reference.deckId, {
        id: reference.deckId, name: reference.deckName, commander: reference.commander,
        commander_image: reference.commanderImage, bracket: reference.bracket,
        source_type: reference.deckKind === 'guest' ? 'guest' : reference.sourceType, is_favorite: options.get(reference.deckId)?.is_favorite ?? false,
      });
    }
    return Array.from(options.values());
  }, [decksByUser, guests, presetReferences]);
  const setupParticipants = useMemo<SetupParticipant[]>(() => {
    const known: SetupParticipant[] = [
      ...members.map(member => {
        const key = toUserParticipantKey(member.id);
        const options = getDeckOptions(key);
        return {key, name: getProfileDisplayName(member), decks: options,
          preferredDeckId: getPreferredDeckId(options, getLastDeckSelectionForParticipant(key, matches))};
      }),
      ...guests.map(guest => {
        const key = toGuestParticipantKey(guest.id);
        const options = getDeckOptions(key);
        return {key, name: guest.display_name, decks: options,
          preferredDeckId: getPreferredDeckId(options, getLastDeckSelectionForParticipant(key, matches))};
      }),
    ];
    for (const reference of presetReferences) {
      if (!known.some(participant => participant.key === reference.participantKey)) {
        known.push({key: reference.participantKey, name: reference.displayName,
          decks: getDeckOptions(reference.participantKey), preferredDeckId: reference.deckId});
      }
    }
    return known.map(participant => ({...participant,
      name: presetReferences.find(reference => reference.participantKey === participant.key)?.displayName ?? participant.name}));
  }, [getDeckOptions, guests, matches, members, presetReferences]);
  const latestParticipants = useRef(setupParticipants);
  useLayoutEffect(() => { latestParticipants.current = setupParticipants; }, [setupParticipants]);
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
  const applyPreset = useCallback((prepared: PreparedTablePreset) => {
    const draft = prepared.draft;
    setPlayerCount(draft.playerCount);
    setLayoutVariant(draft.layoutVariant);
    applyStartingLife(draft.startingLife);
    applySeatSetups(draft.seats.map(({participantKey, deckId}) => ({participantKey, deckId})));
    setPresetProjection(current => ({key: contextKey, references: prepared.references,
      revision: current.key === contextKey ? current.revision + 1 : 1}));
  }, [applySeatSetups, applyStartingLife, contextKey]);
  const presetReviewRevision = presetProjection.key === contextKey ? presetProjection.revision : 0;
  const presetMissingReferences = presetReviewRevision > 0
    ? seatSetups.filter(seat => !seat.participantKey || !seat.deckId).length : 0;
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
  useLayoutEffect(() => {
    setupHydratingRef.current?.controller.abort();
    setupHydratingRef.current = null;
    setupHydratedRef.current = null;
    setSetupReadyKey(null);
    setSetupRestoreError(false);
    setOccasionalDecks([]);
    setPresetProjection({key: contextKey, references: [], revision: 0});
    const defaults = createDefaultLiveGameSetup();
    setPlayerCount(defaults.playerCount);
    setLayoutVariant(defaults.layoutVariant);
    applyStartingLife(defaults.startingLife);
    applySeatSetups(defaults.seats);
    return () => {
      const job = setupHydratingRef.current;
      setupHydratingRef.current = null;
      job?.controller.abort();
    };
  }, [epoch, contextKey, applySeatSetups, applyStartingLife]);
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
    if (!groupId || !userId || loading || !isCurrent() || setupHydratingRef.current || setupHydratedRef.current === `${userId}:${groupId}`) return;
    const job = { controller: new AbortController() };
    setupHydratingRef.current = job;
    const active = () => isCurrent() && setupHydratingRef.current === job;
    setSetupRestoreError(false);
    void loadLiveGameSetup(groupId, userId).then(async (saved) => {
      if (!active()) return;
      if (!saved) { setupHydratedRef.current = `${userId}:${groupId}`; setSetupReadyKey(`${userId}:${groupId}`); return; }
      const savedDeckIds = saved.seats.filter(seat => seat.participantKey?.startsWith('user:') && seat.deckId).map(seat => seat.deckId!);
      let restoredDecks: MemberDeck[] = [];
      if (savedDeckIds.length) {
        restoredDecks = await restoreSetupDecks(bindClient().client, groupId, savedDeckIds, job.controller.signal);
        if (!active()) return;
        setOccasionalDecks(current => [...current.filter(deck => !restoredDecks.some(restored => restored.id === deck.id)), ...restoredDecks]);
      }
      const participantMap = new Map(latestParticipants.current.map((participant) => [participant.key, participant]));
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
      setupHydratedRef.current = `${userId}:${groupId}`;
      setSetupReadyKey(`${userId}:${groupId}`);
    }).catch(() => { if (active()) setSetupRestoreError(true); }).finally(() => { if (active()) setupHydratingRef.current = null; });
  }, [applySeatSetups, applyStartingLife, bindClient, groupId, isCurrent, loading, setupParticipants, setupRetry, userId]);
 return { selectedKeys, participantDecks, playerCount, setPlayerCount, layoutVariant, setLayoutVariant, seatSetups, setupReadyKey, setupRestoreError, setSetupRetry, startingLife, setOccasionalDecks, getDeckOptions, setupParticipants, applySeatSetups, applyStartingLife, handlePlayerCountChange, handleAssignSeat, resetSetup, applyPreset, presetReviewRevision, presetMissingReferences };
}
