import { describe, expect, it } from 'vitest';
import { resolvePresentationCommanderCmc } from '@/packages/domain/commander-presentation';

describe('commander presentation metadata', () => {
  it.each([
    ['Commander', 'Commander', 4, null, 4],
    ['Commander', 'Commander', 4, 0, 0],
    ['Commander', 'Other', 4, 5, 5],
    ['Commander', 'Other', 4, null, null],
    ['Commander', 'Commander', null, null, null],
    ['Commander', ' commander ', 4.5, null, 4.5],
    ['Commander', ' ', 4, null, null],
  ] as const)('preserves metadata only for the same identity (%s → %s)',
    (previousCommander, nextCommander, storedCmc, resolvedCmc, expected) => {
      const input = Object.freeze({ previousCommander, nextCommander, storedCmc, resolvedCmc });
      expect(resolvePresentationCommanderCmc(input)).toBe(expected);
    });
});
