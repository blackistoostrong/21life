import {expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {arenaRecapPeriod} from '@/lib/arena-recap-period';

it('uses 7 or 30 device calendar days without mutating the captured clock', () => {
  const now = new Date('2026-11-27T12:34:56Z'), original = now.toISOString();
  for (const days of [7, 30] as const) {
    const period = arenaRecapPeriod(days, now);
    expect(period.days).toBe(days); expect(period.timeZone).toBeTruthy();
    expect(Date.parse(period.since)).toBeLessThan(now.getTime());
    expect(Date.parse(period.until)).toBeGreaterThan(now.getTime());
    expect(period.lastDay).toMatch(/^2026-11-2[78]$/);
  }
  expect(now.toISOString()).toBe(original);
});
it('rejects invalid clocks, unsupported periods and SQL-incompatible calendar bounds', () => {
  expect(() => arenaRecapPeriod(7, new Date(NaN))).toThrow('ARENA_RECAP_PERIOD_INVALID');
  expect(() => Reflect.apply(arenaRecapPeriod, null, [8])).toThrow('ARENA_RECAP_PERIOD_INVALID');
  expect(() => arenaRecapPeriod(30, new Date('0001-01-02T12:00:00Z'))).toThrow('ARENA_RECAP_PERIOD_INVALID');
  expect(() => arenaRecapPeriod(7, new Date('9999-12-31T12:00:00Z'))).toThrow('ARENA_RECAP_PERIOD_INVALID');
});
const source = new URL('../../packages/domain/arena-recap-period.ts', import.meta.url).href;
it.each([
  ['Europe/Rome', '2026-03-29T12:00:00Z', 7, '2026-03-22T23:00:00.000Z', '2026-03-29T22:00:00.000Z', '2026-03-23', '2026-03-29'],
  ['Europe/Rome', '2026-10-25T12:00:00Z', 7, '2026-10-18T22:00:00.000Z', '2026-10-25T23:00:00.000Z', '2026-10-19', '2026-10-25'],
  ['America/New_York', '2026-03-08T12:00:00Z', 7, '2026-03-02T05:00:00.000Z', '2026-03-09T04:00:00.000Z', '2026-03-02', '2026-03-08'],
  ['Europe/Rome', '2026-11-26T23:01:00Z', 7, '2026-11-20T23:00:00.000Z', '2026-11-27T23:00:00.000Z', '2026-11-21', '2026-11-27'],
  ['Asia/Kathmandu', '2026-11-27T20:30:00Z', 7, '2026-11-21T18:15:00.000Z', '2026-11-28T18:15:00.000Z', '2026-11-22', '2026-11-28'],
  ['UTC', '2024-03-01T00:00:00Z', 30, '2024-02-01T00:00:00.000Z', '2024-03-02T00:00:00.000Z', '2024-02-01', '2024-03-01'],
] as const)('preserves calendar boundaries in %s at %s', (zone, clock, days, since, until, firstDay, lastDay) => {
  // Separate processes test real device-style local Date semantics, including
  // Windows Node, without changing the timezone of other Vitest workers.
  const script = `import {arenaRecapPeriod} from ${JSON.stringify(source)};console.log(JSON.stringify(arenaRecapPeriod(${days},new Date(${JSON.stringify(clock)}))));`;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script],
    {env: {...process.env, TZ: zone}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
  expect(result).toMatchObject({days, since, until, firstDay, lastDay,
    timeZone: new Intl.DateTimeFormat('en', {timeZone: zone}).resolvedOptions().timeZone});
});
