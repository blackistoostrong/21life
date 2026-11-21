import { describe, expect, it, vi } from 'vitest';
import {
  buildProfileDeckPerformanceMaps,
  fetchProfileDeckPerformance,
} from '@/lib/profile-deck-performance';
import { profileCatalogFixture } from '../../../tests/fixtures/profile-catalog';

describe('profile deck performance', () => {
  it('keeps empty legacy catalogs distinct from tracked samples',()=>{
    const maps=buildProfileDeckPerformanceMaps([{deck_id:'empty',games_played:0,wins:0,draws:0,mastery_points:0,tracked_games:0,
      second_places:0,damage_dealt:0,damage_taken:0,life_gained:0,commander_damage:0,infect_dealt:0,eliminations:0,median_winning_duration_seconds:null}]);
    expect(maps.performance.empty).toMatchObject({gamesPlayed:0,winRate:0,masteryPoints:0,trackingCoverage:0,medianWinningDurationSeconds:null});
  });
  it('maps all-time V6/V7 facts into mastery-compatible performance', () => {
    const result = buildProfileDeckPerformanceMaps([{
      deck_id: 'deck-1',
      games_played: 12,
      wins: 4,
      draws: 2,
      mastery_points: 20,
      tracked_games: 9,
      second_places: 2,
      damage_dealt: '240',
      damage_taken: 180,
      life_gained: 30,
      commander_damage: 42,
      infect_dealt: 3,
      eliminations: 7,
      median_winning_duration_seconds: 2700,
    }]);

    // 4 wins over 10 decisive games — the 2 draws stay out of the rate.
    expect(result.winRates['deck-1']).toEqual({
      gamesPlayed: 12, wins: 4, losses: 6, draws: 2, decisiveGames: 10, winRate: 40,
    });
    expect(result.performance['deck-1']).toMatchObject({
      trackedGames: 9,
      trackingCoverage: 75,
      damageDealt: 240,
    });
  });

  it('requires complete v2 metrics without a capped compatibility fallback', async () => {
    const abortSignal=vi.fn()
      .mockResolvedValueOnce({ data: profileCatalogFixture(),error:null })
      .mockResolvedValueOnce({ data:null,error:{message:'missing function'} });
    const rpc=vi.fn(()=>({abortSignal}));
    const result=await fetchProfileDeckPerformance({rpc} as never,'self');
    expect(result.winRates['deck-1'].winRate).toBe(50);
    expect(result.performance['deck-1']).toMatchObject({damageDealt:31,trackingCoverage:67});
    await expect(fetchProfileDeckPerformance({rpc} as never,'self')).rejects.toThrow('ANALYTICS_UNAVAILABLE');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('get_profile_deck_performance_v2',{p_user_id:'self'});
  });
});
