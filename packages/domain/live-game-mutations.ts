import type { LiveGameEventType, LiveGameEvent, LiveGameState, LiveGameMutation } from './live-game-types';
import { aggregateLiveGameEvent, isLiveGameHighlight, compactLiveGameHighlights } from './live-game-events';
import { bumpLiveGameState, applyDamage, applyHealing, eliminatePlayerAt, revivePlayer, autoEliminatePlayers } from './live-game-players';

export function applyLiveGameMutation(
  state: LiveGameState,
  mutation: LiveGameMutation,
  clock: () => string,
): LiveGameState {
  const eventId = mutation.eventId;
  const occurredAt = mutation.occurredAt;
  const appendEvent = (
    next: LiveGameState,
    event: Omit<LiveGameEvent, 'id' | 'occurredAt'>,
    suffix = '',
  ): LiveGameState => {
    if (!eventId || !occurredAt) return next;
    const id = `${eventId}${suffix}`;
    const completeEvent = {
      id,
      occurredAt,
      actionId: mutation.actionId,
      isCorrection: mutation.isCorrection,
      ...event,
    };
    if (isLiveGameHighlight(completeEvent) && next.events.some((entry) => entry.id === id)) return next;
    return {
      ...next,
      events: isLiveGameHighlight(completeEvent)
        ? compactLiveGameHighlights([...next.events, completeEvent])
        : next.events,
      summary: aggregateLiveGameEvent(next.summary, completeEvent),
    };
  };

  if (mutation.type === 'last_standing') {
    const winner = state.players.find((player) => (
      player.participantKey === mutation.winnerKey && !player.isEliminated
    ));
    if (!winner) return state;

    const opponents = state.players.filter((player) => (
      !player.isEliminated && player.participantKey !== mutation.winnerKey
    ));
    if (opponents.length === 0) return state;

    const actionId = mutation.actionId ?? mutation.eventId;
    const next = opponents.reduce((current, player, index) => applyLiveGameMutation(current, {
      type: 'adjust',
      targetKey: player.participantKey,
      sourceKey: mutation.winnerKey,
      amount: player.life > 0 ? player.life : 1,
      mode: 'life',
      eventId: mutation.eventId ? `${mutation.eventId}:${index}` : undefined,
      occurredAt: mutation.occurredAt,
      actionId,
      groupScope: 'opponents',
      isCorrection: mutation.isCorrection,
    }, clock), state);

    return { ...next, version: state.version + 1 };
  }

  if (mutation.type === 'adjust_many') {
    if (mutation.amount === 0) return state;
    const targets = state.players.filter((player) => (
      !player.isEliminated
      && (mutation.scope === 'all_players' || player.participantKey !== mutation.sourceKey)
    ));
    if (targets.length === 0) return state;

    const actionId = mutation.actionId ?? mutation.eventId;
    const mode = mutation.mode ?? 'life';
    const next = targets.reduce((current, player, index) => applyLiveGameMutation(current, {
      type: 'adjust',
      targetKey: player.participantKey,
      sourceKey: mutation.sourceKey,
      amount: mutation.amount,
      mode,
      eventId: mutation.eventId ? `${mutation.eventId}:${index}` : undefined,
      occurredAt: mutation.occurredAt,
      actionId,
      groupScope: mutation.scope,
      isCorrection: mutation.isCorrection,
    }, clock), state);

    const drainAmount = mutation.drain
      ? mutation.drainAmount ?? Math.abs(mutation.amount) * targets.length
      : 0;
    const withDrain = drainAmount > 0
      ? applyLiveGameMutation(next, {
        type: 'adjust',
        targetKey: mutation.sourceKey,
        sourceKey: mutation.amount > 0 ? mutation.sourceKey : undefined,
        amount: mutation.amount > 0 ? -drainAmount : drainAmount,
        mode: 'life',
        eventId: mutation.eventId ? `${mutation.eventId}:drain` : undefined,
        occurredAt: mutation.occurredAt,
        actionId,
        groupScope: mutation.scope,
        isCorrection: mutation.isCorrection,
      }, clock)
      : next;

    // A table-wide action is one optimistic/realtime mutation, regardless of
    // how many participant counters it updates.
    return { ...withDrain, version: state.version + 1 };
  }

  if (mutation.type === 'adjust') {
    const beforePlayer = state.players.find((player) => player.participantKey === mutation.targetKey);
    const next = mutation.amount >= 0
      ? applyDamage(state, mutation.targetKey, mutation.amount, mutation.mode, mutation.sourceKey)
      : applyHealing(state, mutation.targetKey, Math.abs(mutation.amount), mutation.mode, mutation.sourceKey);
    let withAutoKo = { ...autoEliminatePlayers(next, clock), version: state.version + 1 };
    const afterPlayer = withAutoKo.players.find((player) => player.participantKey === mutation.targetKey);
    const appliedAmount = beforePlayer && afterPlayer
      ? mutation.mode === 'life'
        ? Math.abs(afterPlayer.life - beforePlayer.life)
        : mutation.mode === 'infect'
          ? Math.abs(afterPlayer.infect - beforePlayer.infect)
          : mutation.sourceKey
            ? Math.abs(
              (afterPlayer.commanderDamageFrom[mutation.sourceKey] ?? 0)
              - (beforePlayer.commanderDamageFrom[mutation.sourceKey] ?? 0),
            )
            : 0
      : 0;
    if (beforePlayer && afterPlayer && appliedAmount > 0) {
      const eventType: LiveGameEventType = mutation.amount < 0 && mutation.mode === 'life'
        ? 'lifegain'
        : mutation.mode === 'commander'
          ? 'commander_damage'
          : mutation.mode === 'infect' ? 'infect' : 'damage';
      withAutoKo = appendEvent(withAutoKo, {
        type: eventType,
        targetKey: mutation.targetKey,
        sourceKey: mutation.sourceKey ?? null,
        amount: appliedAmount,
        direction: mutation.mode === 'life'
          ? mutation.amount < 0 ? 'increase' : 'decrease'
          : mutation.amount < 0 ? 'decrease' : 'increase',
        groupScope: mutation.groupScope,
      });
      if (!beforePlayer.isEliminated && afterPlayer.isEliminated) {
        withAutoKo = appendEvent(withAutoKo, {
          type: 'elimination',
          targetKey: mutation.targetKey,
          sourceKey: mutation.sourceKey ?? null,
          amount: null,
        }, ':ko');
      }
    }
    const drainAmount = mutation.drain && mutation.sourceKey
      && mutation.sourceKey !== mutation.targetKey
      ? mutation.drainAmount ?? appliedAmount
      : 0;
    if (drainAmount > 0) {
      const withDrain = applyLiveGameMutation(withAutoKo, {
        type: 'adjust',
        targetKey: mutation.sourceKey!,
        sourceKey: mutation.amount > 0 ? mutation.sourceKey : undefined,
        amount: mutation.amount > 0 ? -drainAmount : drainAmount,
        mode: 'life',
        eventId: mutation.eventId ? `${mutation.eventId}:drain` : undefined,
        occurredAt: mutation.occurredAt,
        actionId: mutation.actionId ?? mutation.eventId,
        isCorrection: mutation.isCorrection,
      }, clock);
      return { ...withDrain, version: state.version + 1 };
    }
    return withAutoKo;
  }
  if (mutation.type === 'eliminate') {
    return appendEvent(eliminatePlayerAt(state, mutation.targetKey, mutation.eliminatedAt), {
      type: 'elimination',
      targetKey: mutation.targetKey,
      sourceKey: null,
      amount: null,
    });
  }
  if (mutation.type === 'revive') {
    return appendEvent(revivePlayer(state, mutation.targetKey, mutation.startingLife), {
      type: 'revive',
      targetKey: mutation.targetKey,
      sourceKey: null,
      amount: null,
    });
  }
  if (mutation.type === 'adjust_counter') {
    const players = state.players.map((player) => player.participantKey === mutation.targetKey
      ? {
          ...player,
          counters: {
            ...player.counters,
            [mutation.counter]: Math.max(0, (player.counters?.[mutation.counter] ?? 0) + mutation.amount),
          },
        }
      : player);
    return bumpLiveGameState({ ...state, players });
  }
  if (mutation.type === 'set_emblem' || mutation.type === 'restore_emblem') {
    const holderKey = mutation.type === 'restore_emblem'
      ? mutation.holderKey
      : mutation.active ? mutation.targetKey : null;
    const players = state.players.map((player) => ({
      ...player,
      counters: {
        ...player.counters,
        [mutation.emblem]: player.participantKey === holderKey,
      },
    }));
    return bumpLiveGameState({ ...state, players });
  }

  const players = state.players.map((player) => (
    player.participantKey === mutation.player.participantKey ? mutation.player : player
  ));
  return appendEvent(bumpLiveGameState({ ...state, players }), {
    type: 'correction',
    targetKey: mutation.player.participantKey,
    sourceKey: null,
    amount: null,
  });
}
