import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ArenaPlayerReport} from '@/components/arena/arena-player-report';
import {buildMatchRecord,type MatchRecordCounts} from '@/lib/win-rate';
import type {PlayerStats} from '@/lib/types/arena-player-report';
import {ArenaDeckSummary} from '@/components/arena/arena-deck-summary';

vi.mock('@/components/language-provider',()=>({useLanguage:()=>({language:'en',
 copy:(value:string|{en:string})=>typeof value==='string'?value:value.en})}));
beforeEach(()=>vi.stubGlobal('React',React));
afterEach(()=>vi.unstubAllGlobals());

function text(records:MatchRecordCounts[]){
 const players:PlayerStats[]=records.map((record,index)=>({key:`user:${index}`,displayName:`Player ${index}`,profile:null,isGuest:false,...buildMatchRecord(record)}));
 return renderToStaticMarkup(createElement(ArenaPlayerReport,{
  status:{loading:false,error:false,onRetry:()=>undefined},playerStats:players,
  playerRanksByIndex:players.map((_,index)=>index+1),totalMatches:records.reduce((total,record)=>total+record.gamesPlayed,0),
  guests:[],canManageGroup:false,guestDeletion:{deletingGuestIds:[],handleDeleteGuest:async()=>undefined},
 })).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
}

it('renders the real player report without zero-percent losses for a draw-only group',()=>{
 const rendered=text([{gamesPlayed:4,wins:0,draws:4}]);
 expect(rendered).not.toContain('0%');expect(rendered).toContain('— win rate');
 expect(rendered).toMatch(/Avg Win Rate\s+—/);expect(rendered).toContain('0W-0L-4D');
});
it('keeps genuine zero-percent losses visible in the real report',()=>{
 const rendered=text([{gamesPlayed:1,wins:0,draws:0}]);
 expect(rendered).toContain('0% win rate');expect(rendered).toMatch(/Avg Win Rate\s+0%/);
});
it('excludes a draw-only player from the displayed unweighted player average',()=>{
 const rendered=text([{gamesPlayed:1,wins:1},{gamesPlayed:5,wins:0,draws:5}]);
 expect(rendered).toMatch(/Avg Win Rate\s+100%/);expect(rendered).toContain('0W-0L-5D');
});

it('does not invent zero-percent deck rates when the ranked deck selection is empty',()=>{
 const rendered=renderToStaticMarkup(createElement(ArenaDeckSummary,{visibleDeckStats:[],totalDecks:0}))
  .replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
 expect(rendered).not.toContain('0%');expect(rendered).toContain('— win rate');
 expect(rendered).toMatch(/Avg Win Rate\s+—/);
});
