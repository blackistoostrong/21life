import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyLiveGameMutation, createLiveGamePlayer, getDefaultWinCondition,
  pickRandomPlayer, type LiveGameState } from '../../packages/domain/live-game';
import * as runtime from '../../packages/data/live-game-runtime';
import { isoToMatchDateValue } from '../../packages/domain/match-datetime';
import { createLiveGameHistory, parseLiveGameHistory, recordLiveGameHistory,
  undoLiveGameHistory, redoLiveGameHistory, LIVE_GAME_HISTORY_LIMIT,
  type LiveGameHistoryEntry } from '../../packages/domain/live-game-history';

function state(count = 4): LiveGameState {
  const keys = Array.from({ length: count }, (_, index) => `user:p${index}` as const);
  return { version: 0, events: [], players: keys.map((participantKey, slot) => createLiveGamePlayer({
    slot, participantKey, deckId: `deck-${slot}`, displayName: `Fixture ${slot}`,
    commander: 'Commander', commanderImage: null, startingLife: 40, allParticipantKeys: keys,
  })) };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('deterministic shared live engine', () => {
  it('threads the supplied clock through last-standing recursion without modifying its input', () => {
    const original = freeze(state());
    const times = ['2026-01-01T00:00:00.001Z', '2026-01-01T00:00:00.002Z', '2026-01-01T00:00:00.003Z'];
    let index = 0;
    const clock = vi.fn(() => times[index++]);
    const result = applyLiveGameMutation(original, { type: 'last_standing', winnerKey: 'user:p0',
      eventId: 'finish', occurredAt: '2026-01-01T12:00:00Z' }, clock);
    expect(clock).toHaveBeenCalledTimes(3);
    expect(result.version).toBe(1);
    expect(result.players.slice(1).map(player => player.eliminatedAt)).toEqual(times);
    expect(result.players[0].life).toBe(40);
    expect(result.summary?.totalEvents).toBe(6);
    expect(getDefaultWinCondition(result)).toBe('last_standing');
    expect(original.players.every(player => !player.isEliminated)).toBe(true);
  });

  it('keeps table-wide damage/drain atomic while sharing the same elimination clock', () => {
    const clock = vi.fn(() => '2026-01-01T00:00:00Z');
    const result = applyLiveGameMutation(freeze(state(3)), { type: 'adjust_many', sourceKey: 'user:p0',
      amount: 40, scope: 'opponents', drain: true, eventId: 'group', occurredAt: '2026-01-01T12:00:00Z' }, clock);
    expect(clock).toHaveBeenCalledTimes(2);
    expect(result.version).toBe(1);
    expect(result.players.map(player => player.life)).toEqual([120, 0, 0]);
    expect(result.players.slice(1).every(player => player.eliminatedAt === '2026-01-01T00:00:00Z')).toBe(true);
  });

  it('uses only the supplied random source and does not draw for an empty eligible pool', () => {
    const random = vi.fn(() => 0.99);
    expect(pickRandomPlayer(freeze(state()), ['user:p0', 'user:p2'], random)?.participantKey).toBe('user:p2');
    expect(random).toHaveBeenCalledTimes(1);
    random.mockClear();
    expect(pickRandomPlayer(state(), ['user:missing'], random)).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });

  it('keeps ambient defaults in the compatibility adapter', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const original = state();
    expect(runtime.eliminatePlayer(original, 'user:p1').players[1].eliminatedAt).toBe('2026-01-01T00:00:00.000Z');
    const lethal = { ...original, players: original.players.map(player => ({ ...player, life: 0 })) };
    expect(runtime.autoEliminatePlayers(lethal).players.every(player => player.eliminatedAt === '2026-01-01T00:00:00.000Z')).toBe(true);
    expect(runtime.applyLiveGameMutation(original, { type: 'last_standing', winnerKey: 'user:p0' }).players[1].eliminatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(runtime.pickRandomPlayer(original)?.participantKey).toBe('user:p0');
  });

  it('requests the date fallback only for an invalid timestamp, preserving null history', () => {
    const clock = vi.fn(() => new Date('2026-02-15T12:00:00'));
    expect(isoToMatchDateValue(null, clock)).toBe('');
    expect(clock).not.toHaveBeenCalled();
    expect(isoToMatchDateValue('invalid', clock)).toBe('2026-02-15');
    expect(clock).toHaveBeenCalledTimes(1);
  });

  it('bounds restored undo/redo history and preserves correction flags without changing input', () => {
    const entries: LiveGameHistoryEntry[] = Array.from({ length: 40 }, (_, index) => ({
      forward: { type: 'adjust', targetKey: 'user:p0', amount: 1, mode: 'life', eventId: String(index) },
      inverse: { type: 'adjust', targetKey: 'user:p0', amount: -1, mode: 'life', eventId: String(index) },
    }));
    const original = freeze({ undo: entries, redo: entries });
    const restored = parseLiveGameHistory(original);
    expect(restored.undo).toHaveLength(LIVE_GAME_HISTORY_LIMIT);
    expect(restored.undo[0].forward.eventId).toBe('10');
    expect(restored.redo).toHaveLength(LIVE_GAME_HISTORY_LIMIT);
    const undone = undoLiveGameHistory(freeze(restored))!;
    expect(undone.mutation.isCorrection).toBe(true);
    expect(undone.history.redo).toHaveLength(LIVE_GAME_HISTORY_LIMIT);
    const redone = redoLiveGameHistory(freeze(undone.history))!;
    expect(redone.mutation.isCorrection).toBe(false);
    expect(redone.history.undo).toHaveLength(LIVE_GAME_HISTORY_LIMIT);
    expect(recordLiveGameHistory(freeze(restored), entries[0]).redo).toEqual([]);
    expect(original.undo).toHaveLength(40);
  });

  it('keeps empty and legacy history recovery safe', () => {
    const empty = createLiveGameHistory();
    for (const raw of [null, 1, [], { undo: 'invalid', redo: null }]) expect(parseLiveGameHistory(raw)).toEqual(empty);
    expect(undoLiveGameHistory(empty)).toBeNull();
    expect(redoLiveGameHistory(empty)).toBeNull();
  });
});
