import { describe, expect, it } from 'vitest';
import { expandDeckCommanderNames } from '../../packages/domain/commander-names';

describe('commander name normalization contract', () => {
  it('preserves first occurrence order across partner and single-slash forms', () => {
    expect(expandDeckCommanderNames(' A // B / A // C ')).toEqual(['A', 'B', 'C']);
  });
  it('drops empty segments and keeps case-sensitive distinct names', () => {
    expect(expandDeckCommanderNames(' / // ')).toEqual([]);
    expect(expandDeckCommanderNames('A / a / A')).toEqual(['A', 'a']);
  });
});
