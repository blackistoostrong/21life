import type { DamageMode, LiveGamePlayer, LiveGameState } from './live-game-types';
import { COMMANDER_DAMAGE_LIMIT, INFECT_LOSS_THRESHOLD } from './live-game-types';
import type { ParticipantKey } from './participant-keys';

export function bumpLiveGameState(state: LiveGameState): LiveGameState {
  return { ...state, version: state.version + 1 };
}

export function createLiveGamePlayer(input: {
  slot: number;
  participantKey: ParticipantKey;
  deckId: string;
  displayName: string;
  commander: string;
  commanderImage: string | null;
  backgroundColor?: string | null;
  startingLife: number;
  allParticipantKeys: ParticipantKey[];
}): LiveGamePlayer {
  const commanderDamageFrom = Object.fromEntries(
    input.allParticipantKeys
      .filter((key) => key !== input.participantKey)
      .map((key) => [key, 0]),
  ) as Record<ParticipantKey, number>;

  return {
    slot: input.slot,
    participantKey: input.participantKey,
    deckId: input.deckId,
    displayName: input.displayName,
    commander: input.commander,
    commanderImage: input.commanderImage,
    backgroundColor: input.backgroundColor ?? null,
    life: input.startingLife,
    infect: 0,
    commanderDamageFrom,
    counters: {
      energy: 0,
      experience: 0,
      commanderTax: 0,
      monarch: false,
      initiative: false,
    },
    isEliminated: false,
    eliminatedAt: null,
  };
}

export function getActivePlayers(state: LiveGameState): LiveGamePlayer[] {
  return state.players.filter((player) => !player.isEliminated);
}

export function shouldAutoEliminate(player: LiveGamePlayer): boolean {
  if (player.life <= 0) return true;
  if (player.infect >= INFECT_LOSS_THRESHOLD) return true;
  return Object.values(player.commanderDamageFrom).some((damage) => damage >= COMMANDER_DAMAGE_LIMIT);
}

export function applyDamage(
  state: LiveGameState,
  targetKey: ParticipantKey,
  amount: number,
  mode: DamageMode,
  sourceKey?: ParticipantKey,
): LiveGameState {
  if (amount <= 0) return state;

  const players = state.players.map((player) => {
    if (player.participantKey !== targetKey || player.isEliminated) return player;

    if (mode === 'infect') {
      return { ...player, infect: player.infect + amount };
    }

    if (mode === 'commander') {
      if (!sourceKey || sourceKey === targetKey) return player;
      const current = player.commanderDamageFrom[sourceKey] ?? 0;
      return {
        ...player,
        life: player.life - amount,
        commanderDamageFrom: {
          ...player.commanderDamageFrom,
          [sourceKey]: current + amount,
        },
      };
    }

    return { ...player, life: player.life - amount };
  });

  return bumpLiveGameState({ ...state, players });
}

export function applyHealing(
  state: LiveGameState,
  targetKey: ParticipantKey,
  amount: number,
  mode: DamageMode,
  sourceKey?: ParticipantKey,
): LiveGameState {
  if (amount <= 0) return state;

  const players = state.players.map((player) => {
    if (player.participantKey !== targetKey || player.isEliminated) return player;

    if (mode === 'infect') {
      return { ...player, infect: Math.max(0, player.infect - amount) };
    }

    if (mode === 'commander') {
      if (!sourceKey || sourceKey === targetKey) return player;
      const current = player.commanderDamageFrom[sourceKey] ?? 0;
      const restored = Math.min(amount, current);
      return {
        ...player,
        life: player.life + restored,
        commanderDamageFrom: {
          ...player.commanderDamageFrom,
          [sourceKey]: current - restored,
        },
      };
    }

    return { ...player, life: player.life + amount };
  });

  return bumpLiveGameState({ ...state, players });
}

export function eliminatePlayerAt(
  state: LiveGameState,
  targetKey: ParticipantKey,
  eliminatedAt: string,
): LiveGameState {
  const players = state.players.map((player) => {
    if (player.participantKey !== targetKey || player.isEliminated) return player;
    return {
      ...player,
      isEliminated: true,
      eliminatedAt,
      life: Math.min(player.life, 0),
    };
  });

  return bumpLiveGameState({ ...state, players });
}

export function revivePlayer(state: LiveGameState, targetKey: ParticipantKey, startingLife: number): LiveGameState {
  const players = state.players.map((player) => {
    if (player.participantKey !== targetKey || !player.isEliminated) return player;
    const commanderDamageFrom = Object.fromEntries(
      Object.keys(player.commanderDamageFrom).map((key) => [key, 0]),
    ) as Record<ParticipantKey, number>;
    return {
      ...player,
      isEliminated: false,
      eliminatedAt: null,
      life: startingLife,
      infect: 0,
      commanderDamageFrom,
    };
  });

  return bumpLiveGameState({ ...state, players });
}

export function autoEliminatePlayers(state: LiveGameState, clock: () => string): LiveGameState {
  let next = state;
  state.players.forEach((player) => {
    if (!player.isEliminated && shouldAutoEliminate(player)) {
      next = eliminatePlayerAt(next, player.participantKey, clock());
    }
  });
  return next;
}

export function pickRandomPlayer(state: LiveGameState, pool: ParticipantKey[] | undefined, random: () => number): LiveGamePlayer | null {
  const keys = pool?.length
    ? pool
    : getActivePlayers(state).map((player) => player.participantKey);

  const active = state.players.filter(
    (player) => !player.isEliminated && keys.includes(player.participantKey),
  );

  if (active.length === 0) return null;
  return active[Math.floor(random() * active.length)];
}
