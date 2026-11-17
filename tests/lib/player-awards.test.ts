import { describe, expect, it } from 'vitest';
import { buildPlayerAwards } from '@/lib/player-awards';

const player = (id: string, name: string, overrides = {}) => ({ id, user_id: id, guest_id: null, deck_id: null, guest_deck_id: null, is_winner: false, profiles: { id, username: name, display_name: name }, ...overrides });

describe('player awards', () => {
  it('ranks maximum single-match life gain and starting-player selections', () => {
    const awards = buildPlayerAwards([
      { match_participants: [player('a', 'A', { life_gained: 18, was_starting_player: true }), player('b', 'B', { life_gained: 25 })] },
      { match_participants: [player('a', 'A', { life_gained: 4, was_starting_player: true }), player('b', 'B', { was_starting_player: true })] },
    ]);
    expect(awards.find((award) => award.kind === 'healing_master')).toMatchObject({ name: 'B', value: 25 });
    expect(awards.find((award) => award.kind === 'beginners_luck')).toMatchObject({ name: 'A', value: 2 });
  });
});

it('preserves legacy counters for registered winners, guests, draws and missing identities',()=>{
 const matches=['combo','last_standing','concession','alternate_card','other'].map(win_condition=>({win_condition,match_participants:[
  player('a','A',{is_winner:true,placement:1,eliminations_caused:2,life_damage_dealt:10}),
  player('b','B',{placement:2,eliminated_at:'2026-01-01T00:00:00Z'}),
  player('missing','Unknown',{user_id:null}),
 ]}));
 const awards=buildPlayerAwards([...matches,{is_draw:true,match_participants:[player('a','A')]}]);
 expect(awards.find(row=>row.kind==='arena_king')).toMatchObject({name:'A',value:100});
 for(const kind of ['combo','last_standing','concession','true_skills','hitman','archenemy','eternal_second'])expect(awards.some(row=>row.kind===kind)).toBe(true);
});
