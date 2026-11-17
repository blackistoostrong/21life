import type {ArenaAnalyticsReport} from '../../packages/domain/arena-analytics';
export const arenaId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const arenaGroup=arenaId(100);
export function arenaReportFixture():ArenaAnalyticsReport {
  return {schemaVersion:2,complete:true,asOf:'2026-11-17T12:00:00.123456Z',groupId:arenaGroup,
    filters:{since:null,until:null,bracket:null},totalMatches:3,participations:3,rankingParticipations:3,
    unknownColorParticipations:0,unlinkedDeckParticipations:0,unlinkedPlayerParticipations:0,bracketOptions:['3'],
    players:[{key:`user:${arenaId(1)}`,user_id:arenaId(1),guest_id:null,is_guest:false,display_name:'Player A',
      games_played:3,wins:1,draws:1,second_places:1,eliminations:1,total_damage_dealt:13,first_eliminations:0,
      combo_wins:1,last_standing_wins:0,concession_wins:0,alternate_wins:0,max_life_gained:18,starts:2}],
    commanders:[{commander:'Commander',commander_image:null,bracket:'3',games_played:3,wins:1,draws:1}],
    colors:[{color_identity:['W'],bracket:'3',appearances:3,wins:1,draws:1}],
    decks:[{key:`deck:${arenaId(10)}`,deck_id:arenaId(10),is_guest_deck:false,deck_name:'Deck',commander:'Commander',
      commander_image:null,owner_display_name:'Player A',bracket:'3',games_played:3,wins:1,draws:1,tracked_games:1,
      second_places:1,first_eliminations:0,comeback_wins:1,combo_wins:1,alternate_wins:0,total_damage_dealt:13,
      total_damage_taken:1,total_life_gained:18,commander_damage_dealt:0,infect_dealt:0,eliminations:1,
      group_damage_dealt:0,group_damage_events:0,median_winning_duration_seconds:61}]};
}
