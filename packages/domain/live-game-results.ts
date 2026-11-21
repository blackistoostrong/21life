import type { WinCondition, LiveGamePlayer, LiveGameState } from './live-game-types';
import type { ParticipantKey } from './participant-keys';
import { getActivePlayers } from './live-game-players';

export type LiveGameResultWarning =
  | 'draw_with_single_survivor'
  | 'winner_marked_eliminated'
  | 'winner_has_lethal_total';

export function getSuggestedWinner(state: LiveGameState): LiveGamePlayer | null {
  const standing = getActivePlayers(state);
  if (standing.length === 1) return standing[0];
  return null;
}

export function getDefaultWinCondition(state: LiveGameState): WinCondition | null {
  return getSuggestedWinner(state) ? 'last_standing' : null;
}

export function isValidLiveGameResult(
  state: LiveGameState,
  result: { winnerKey: ParticipantKey | null; isDraw: boolean; winCondition: WinCondition | null },
): boolean {
  if (result.isDraw) return result.winnerKey === null && result.winCondition === null;
  if (!result.winnerKey || !result.winCondition) return false;
  if (!state.players.some((player) => player.participantKey === result.winnerKey)) return false;

  const suggested = getSuggestedWinner(state);
  if (suggested) {
    return result.winnerKey === suggested.participantKey && result.winCondition === 'last_standing';
  }
  if (result.winCondition === 'last_standing') {
    return state.players.some((player) => (
      player.participantKey === result.winnerKey && !player.isEliminated
    ));
  }
  return true;
}

export function getLiveGameResultWarnings(
  state: LiveGameState,
  result: { winnerKey: ParticipantKey | null; isDraw: boolean; winCondition: WinCondition | null },
): LiveGameResultWarning[] {
  const warnings: LiveGameResultWarning[] = [];
  const activePlayers = getActivePlayers(state);
  if (result.isDraw && activePlayers.length === 1) warnings.push('draw_with_single_survivor');
  if (!result.winnerKey) return warnings;
  const winner = state.players.find((player) => player.participantKey === result.winnerKey);
  if (!winner) return warnings;
  if (winner.isEliminated) warnings.push('winner_marked_eliminated');
  const commanderLethal = Object.values(winner.commanderDamageFrom).some((damage) => damage >= 21);
  if (winner.life <= 0 || winner.infect >= 10 || commanderLethal) warnings.push('winner_has_lethal_total');
  return warnings;
}
