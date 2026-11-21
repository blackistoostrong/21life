/** Compatibility boundary for the ambient clock/RNG used by installed clients. */
export * from '../domain/live-game';
import { applyLiveGameMutation as applyWithClock, autoEliminatePlayers as autoWithClock,
  pickRandomPlayer as pickWithRandom, eliminatePlayerAt,
  type LiveGameState, type LiveGameMutation } from '../domain/live-game';
import type { ParticipantKey } from '../domain/participant-keys';

export function applyLiveGameMutation(state: LiveGameState, mutation: LiveGameMutation): LiveGameState {
  return applyWithClock(state, mutation, () => new Date().toISOString());
}
export function autoEliminatePlayers(state: LiveGameState): LiveGameState {
  return autoWithClock(state, () => new Date().toISOString());
}
export function eliminatePlayer(state: LiveGameState, targetKey: ParticipantKey): LiveGameState {
  return eliminatePlayerAt(state, targetKey, new Date().toISOString());
}
export function pickRandomPlayer(state: LiveGameState, pool?: ParticipantKey[]) {
  return pickWithRandom(state, pool, () => Math.random());
}
