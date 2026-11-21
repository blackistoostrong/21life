import { getParticipantDisplayName, getParticipantKey, type MatchParticipantRecord } from '@/lib/arena-participants';
import {buildPlayerAwardsFromCounters} from '@/packages/domain/player-awards';
export {buildPlayerAwardsFromAggregates} from '@/packages/domain/player-awards';

import type {PlayerAward} from '@/packages/domain/player-awards';
export type {PlayerAwardKind,PlayerAward} from '@/packages/domain/player-awards';

type Match = { is_draw?: boolean; win_condition?: string | null; match_participants: MatchParticipantRecord[] };

export function buildPlayerAwards(matches: Match[]): PlayerAward[] {
  const players = new Map<string, { name: string; games: number; wins: number; draws: number; second: number; eliminations: number; damage: number; first: number; combo: number; last: number; concession: number; skills: number; healing: number; starts: number }>();
  for (const match of matches) {
    const first = match.match_participants.map((p) => p.eliminated_at).filter((value): value is string => Boolean(value)).sort()[0];
    for (const participant of match.match_participants) {
      const key = getParticipantKey(participant); if (!key) continue;
      const row = players.get(key) ?? { name: getParticipantDisplayName(participant), games: 0, wins: 0, draws: 0, second: 0, eliminations: 0, damage: 0, first: 0, combo: 0, last: 0, concession: 0, skills: 0, healing: 0, starts: 0 };
      row.games += 1; row.wins += Number(participant.is_winner); row.draws += Number(Boolean(match.is_draw)); row.second += Number(participant.placement === 2);
      row.eliminations += participant.eliminations_caused || 0; row.damage += participant.life_damage_dealt || 0; row.first += Number(Boolean(first && participant.eliminated_at === first)); row.healing = Math.max(row.healing, participant.life_gained || 0); row.starts += Number(Boolean(participant.was_starting_player));
      if (participant.is_winner) { row.combo += Number(match.win_condition === 'combo'); row.last += Number(match.win_condition === 'last_standing'); row.concession += Number(match.win_condition === 'concession'); row.skills += Number(match.win_condition === 'alternate_card' || match.win_condition === 'other'); }
      players.set(key, row);
    }
  }
  return buildPlayerAwardsFromCounters(Array.from(players.values()));
}
