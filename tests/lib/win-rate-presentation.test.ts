import {expect,it} from 'vitest';
import {averageWinRate,buildMatchRecord,formatWinRate,formatWinRateSummary} from '@/lib/win-rate';

it.each([
 [{gamesPlayed:0,wins:0,draws:0},'—'],
 [{gamesPlayed:4,wins:0,draws:4},'—'],
 [{gamesPlayed:3,wins:1,draws:1},'50%'],
 [{gamesPlayed:1,wins:0,draws:0},'0%'],
 [{gamesPlayed:6,wins:3},'50%'],
])('formats %j without treating draws as losses', (record,label)=>{
 expect(formatWinRate(record)).toBe(label);
});
it('preserves the stored numeric convention and input while displaying a neutral record',()=>{
 const record=Object.freeze({gamesPlayed:5,wins:0,draws:5});
 expect(formatWinRate(record)).toBe('—');expect(buildMatchRecord(record).winRate).toBe(0);
 expect(record).toEqual({gamesPlayed:5,wins:0,draws:5});
});
it.each([{records:[]},{records:[{gamesPlayed:5,wins:0,draws:5}]}])('has no player mean without decisive games: %j',({records})=>{
 expect(averageWinRate(records)).toBeNull();
});
it('does not lower a player mean by counting a draw-only player as zero percent',()=>{
 expect(averageWinRate([{gamesPlayed:5,wins:0,draws:5},{gamesPlayed:1,wins:1}])).toBe(100);
});
it('keeps the existing unweighted mean rather than substituting a pooled percentage',()=>{
 expect(averageWinRate([{gamesPlayed:10,wins:1},{gamesPlayed:1,wins:1}])).toBe(55);
});

it.each([
 [{decisiveGames:0,winRate:0},'—'],
 [{decisiveGames:1,winRate:0},'0%'],
 [{decisiveGames:2,winRate:50},'50%'],
 [{decisiveGames:11,winRate:55},'55%'],
])('formats an already computed summary without inventing its numerator: %j',(record,label)=>{
 expect(formatWinRateSummary(record)).toBe(label);
});
