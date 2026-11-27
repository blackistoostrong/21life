import { describe, expect, it } from 'vitest';
import { buildArenaShareText } from '@/lib/arena-share';
import {buildMatchRecord} from '@/lib/win-rate';

const labels = {
  arenaStatsTitle: 'Arena Stats',
  period: 'Period',
  totalMatches: 'Matches',
  topPlayers: 'Top Players',
  topDecks: 'Top Decks',
  topColors: 'Top Colors',
  recentMatches: 'Recent Matches',
  winner: 'Winner',
  winRate: 'Win rate',
  publicPage: 'Public page',
  noComment: 'No notes',
};

describe('arena-share', () => {
  it('builds shareable text summary', () => {
    const text = buildArenaShareText({
      arenaName: 'Friday Night',
      periodLabel: 'All time',
      totalMatches: 12,
      topPlayers: [{ displayName: 'Marco', gamesPlayed: 10, wins: 6, losses: 3, draws: 1, decisiveGames: 9, winRate: 67 }],
      topDecks: [{ commander: 'Atraxa', gamesPlayed: 5, wins: 3, losses: 2, draws: 0, decisiveGames: 5, winRate: 60, bracket: '3' }],
      topColors: [{ label: 'Esper', gamesPlayed: 4, percentage: 33 }],
      recentMatches: [{
        playedAt: '2026-07-08T20:00:00.000Z',
        winnerName: 'Marco',
        notes: 'Long game',
        participants: [{
          displayName: 'Marco',
          commander: 'Atraxa',
          deckName: 'Atraxa',
          isWinner: true,
          bracket: '3',
        }],
      }],
      publicUrl: 'https://example.com/arena/PHY123',
    }, labels);

    expect(text).toContain('Friday Night');
    // 6 wins over 9 decisive games — the single draw is not a loss.
    expect(text).toContain('Marco - 67% (6W-3L-1D)');
    expect(text).toContain('Atraxa [B3]');
    expect(text).toContain('Public page: https://example.com/arena/PHY123');
    expect(text).toContain('Long game');
  });
});
it.each([
 [{gamesPlayed:3,wins:0,draws:3},'—','0W-0L-3D'],
 [{gamesPlayed:3,wins:0,draws:0},'0%','0W-3L-0D'],
 [{gamesPlayed:3,wins:1,draws:1},'50%','1W-1L-1D'],
] as const)('share text preserves the meaning of %j without sending anything',(counts,label,record)=>{
 const stats=buildMatchRecord(counts);
 const text=buildArenaShareText({arenaName:'Group',periodLabel:'All',totalMatches:3,
  topPlayers:[{...stats,displayName:'Player'}],topDecks:[{...stats,commander:'Commander'}],
  topColors:[],recentMatches:[]},labels);
 expect(text).toContain(`Player - ${label} (${record})`);
 expect(text).toContain(`Commander - ${label} (${record})`);
 if(!stats.decisiveGames)expect(text).not.toContain('0%');
});
