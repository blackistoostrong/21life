import {buildMatchRecord} from './win-rate';
import type {ArenaPlayerAggregate} from './arena-analytics';
export type PlayerAwardKind='veteran'|'eternal_second'|'arena_king'|'hitman'|'berserker'|'archenemy'|'combo'|'last_standing'|'concession'|'true_skills'|'healing_master'|'beginners_luck';
export type PlayerAward={kind:PlayerAwardKind;rank:number;name:string;value:number;gamesPlayed:number;winRate:number};
export type PlayerAwardCounter={key?:string;name:string;games:number;wins:number;draws:number;second:number;eliminations:number;damage:number;first:number;combo:number;last:number;concession:number;skills:number;healing:number;starts:number};
/** One scoring policy for web/native; presentation does not scan paginated history. */
export function buildPlayerAwardsFromCounters(counters:PlayerAwardCounter[]):PlayerAward[]{
  const rows=counters.map(row=>({...row,...buildMatchRecord({gamesPlayed:row.games,wins:row.wins,draws:row.draws})}));
  const definitions:Array<[PlayerAwardKind,(row:typeof rows[number])=>number,boolean]>=[
    ['veteran',r=>r.games,false],['eternal_second',r=>r.second,false],['arena_king',r=>r.winRate,true],
    ['hitman',r=>r.eliminations,false],['archenemy',r=>r.first,false],['combo',r=>r.combo,false],
    ['last_standing',r=>r.last,false],['concession',r=>r.concession,false],['true_skills',r=>r.skills,false],
    ['healing_master',r=>r.healing,false],['beginners_luck',r=>r.starts,false],
  ];
  return definitions.flatMap(([kind,score,minimumFive])=>rows
    .filter(row=>(!minimumFive || row.games>=5) && score(row)>0)
    .sort((a,b)=>score(b)-score(a) || b.games-a.games || (a.key && b.key ? a.name.localeCompare(b.name,'en') : a.name.localeCompare(b.name)) || (a.key??'').localeCompare(b.key??''))
    .slice(0,3).map((row,index)=>({kind,rank:index+1,name:row.name,value:score(row),gamesPlayed:row.games,winRate:row.winRate})));
}
export function buildPlayerAwardsFromAggregates(players:ArenaPlayerAggregate[]):PlayerAward[]{
  return buildPlayerAwardsFromCounters(players.map(row=>({key:row.key,name:row.display_name,games:row.games_played,wins:row.wins,draws:row.draws,
    second:row.second_places,eliminations:row.eliminations,damage:row.total_damage_dealt,first:row.first_eliminations,
    combo:row.combo_wins,last:row.last_standing_wins,concession:row.concession_wins,skills:row.alternate_wins,
    healing:row.max_life_gained,starts:row.starts})));
}
