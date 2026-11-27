import { describe, expect, it } from 'vitest';
import { buildArenaShareText } from '@/lib/arena-share';
import {buildMatchRecord} from '@/lib/win-rate';

const labels = {
  arenaStatsTitle: 'Arena Stats', period: 'Period', totalMatches: 'Matches',
  topPlayers: 'Top Players', topDecks: 'Top Decks', topColors: 'Top Colors',
  recentMatches: 'Recent Matches', winner: 'Winner', winRate: 'Win rate',
  publicPage: 'Public page', noComment: 'No notes',
};

describe('arena share', () => {
  it('limits long sections and keeps optional details readable', () => {
    const text = buildArenaShareText({
      arenaName: 'Friday Night', periodLabel: 'All time', totalMatches: 12,
      topPlayers: Array.from({ length: 6 }, (_, index) => ({ displayName: `P${index}`, gamesPlayed: 10, wins: 5, losses: 5, draws: 0, decisiveGames: 10, winRate: 50 })),
      topDecks: [
        { commander: 'Atraxa', gamesPlayed: 5, wins: 3, losses: 2, draws: 0, decisiveGames: 5, winRate: 60, bracket: '3' },
        { commander: 'Krenko', gamesPlayed: 2, wins: 1, losses: 1, draws: 0, decisiveGames: 2, winRate: 50 },
      ],
      topColors: [{ label: 'Esper', gamesPlayed: 4, percentage: 33 }],
      recentMatches: [{
        playedAt: '2026-07-08T20:00:00.000Z', winnerName: 'Marco', notes: '  Long game  ',
        participants: [
          { displayName: 'Marco', commander: 'Atraxa', deckName: 'Superfriends', isWinner: true, bracket: '3' },
          { displayName: 'No deck', isWinner: false },
        ],
      }],
      publicUrl: 'https://example.com/arena/PHY123',
    }, labels, 'en-US');

    expect(text).toContain('5. P4');
    expect(text).not.toContain('P5');
    expect(text).toContain('Atraxa [B3]');
    expect(text).toContain('Krenko - 50%');
    expect(text).toContain('Marco: Superfriends (Atraxa)');
    expect(text).toContain('No deck: —');
    expect(text).toContain('Long game');
    expect(text).toContain('Public page: https://example.com/arena/PHY123');
  });

  it('omits empty optional sections and the public link', () => {
    const text = buildArenaShareText({
      arenaName: 'Empty', periodLabel: '7 days', totalMatches: 0,
      topPlayers: [], topDecks: [], topColors: [], recentMatches: [],
    }, labels);
    expect(text).not.toContain('Top Colors');
    expect(text).not.toContain('Recent Matches');
    expect(text).not.toContain('Public page');
  });
});

it('does not invent a date for undated historical matches',()=>{
  const text=buildArenaShareText({arenaName:'Group',periodLabel:'All',totalMatches:1,topPlayers:[],topDecks:[],topColors:[],recentMatches:[{playedAt:null,winnerName:'Draw',participants:[]}]},labels);
  expect(text).toContain('—');expect(text).not.toContain('1970');
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
