import { describe, expect, it } from 'vitest';
import { getArenaDayKey, groupMatchesByDay } from '@/lib/arena-session';

describe('arena-session', () => {
  it('uses a server day key when the preceding calendar day is outside this page',()=>{
    const groups=groupMatchesByDay([{id:'late',played_at:'2026-07-11T01:30:00Z',arena_day_key:'2026-07-10'}]);
    expect(groups[0]).toMatchObject({dayKey:'2026-07-10',matchCount:1});
  });
  it('keeps unknown chronology explicit and avoids formatting a fabricated epoch date',()=>{
    const formatLabel=()=>{throw new Error('Unknown date must not reach a date formatter');};
    expect(getArenaDayKey(null)).toBe('undated');
    expect(groupMatchesByDay([{id:'legacy',played_at:null}],{formatLabel,unknownDateLabel:'Data non disponibile'}))
      .toMatchObject([{dayKey:'undated',label:'Data non disponibile',matches:[{id:'legacy',played_at:null}]}]);
  });
  it('assigns late-night matches to the previous day before 08:00 UTC', () => {
    const key = getArenaDayKey('2026-07-11T01:30:00.000Z');
    expect(key).toBe('2026-07-10');
  });

  it('keeps evening matches on the same calendar day from 08:00 UTC onward', () => {
    const key = getArenaDayKey('2026-07-10T21:00:00.000Z');
    expect(key).toBe('2026-07-10');
  });

  it('keeps an isolated late-night match on its calendar day', () => {
    const groups = groupMatchesByDay([
      { id: 'late', played_at: '2026-07-11T01:30:00.000Z' },
    ]);

    expect(groups).toMatchObject([{ dayKey: '2026-07-11', matchCount: 1 }]);
  });

  it('moves a late-night match to the previous day only when that day has a match', () => {
    const groups = groupMatchesByDay([
      { id: 'late', played_at: '2026-07-11T01:30:00.000Z' },
      { id: 'evening', played_at: '2026-07-10T21:00:00.000Z' },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ dayKey: '2026-07-10', matchCount: 2 });
    expect(groups[0].matches.map((match) => match.id)).toEqual(['late', 'evening']);
  });

  it('groups matches by day with newest day first and preserves match order', () => {
    const groups = groupMatchesByDay([
      { id: '3', played_at: '2026-07-11T12:00:00.000Z' },
      { id: '2', played_at: '2026-07-10T12:00:00.000Z' },
      { id: '1', played_at: '2026-07-10T12:00:00.000Z' },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].dayKey).toBe('2026-07-11');
    expect(groups[0].matches.map((match) => match.id)).toEqual(['3']);
    expect(groups[1].dayKey).toBe('2026-07-10');
    expect(groups[1].matchCount).toBe(2);
    expect(groups[1].matches.map((match) => match.id)).toEqual(['2', '1']);
  });
});
