import {expect, it} from 'vitest';
import {createArenaRecapPayload, arenaRecapLabels} from '@/lib/arena-recap-text';
import {summarizeArenaRecap} from '@/lib/arena-recap';
import {formatGameDuration} from '@/lib/live-game-duration';

const period = {days: 7 as const, since: '2026-11-20T23:00:00Z', until: '2026-11-27T23:00:00Z',
  firstDay: '2026-11-21', lastDay: '2026-11-27', timeZone: 'Europe/Rome'};
const summary = summarizeArenaRecap([{id: 'private-match-id', playedAt: '2026-11-27T10:00:00Z', isDraw: false,
  durationSeconds: 120, trackingVersion: 1, participants: [
    {identity: 'user:private-account-id', displayName: 'Alice', commander: 'Commander A', isWinner: true},
    {identity: 'guest:private-guest-id', displayName: 'Bob', commander: 'Commander B', isWinner: false},
  ]}]);
for (const language of ['en', 'it'] as const) it(`formats an anonymous ${language} preview with dates/timezone and no IDs or player names`, () => {
  const payload = createArenaRecapPayload(summary, period, {groupName: 'Pod', language, includeNames: false}, formatGameDuration);
  expect(payload.title).toBe('Pod - 21Life'); expect(payload.text).toContain('Europe/Rome');
  expect(payload.text).toContain(`${arenaRecapLabels(language).player} 1`);
  expect(payload.text).toContain(`${arenaRecapLabels(language).player} 2`);
  expect(payload.text).toContain('Commander A'); expect(payload.text).toContain('2m 00s (1/1)');
  for (const secret of ['Alice', 'Bob', 'private-account-id', 'private-guest-id', 'private-match-id', 'https://']) expect(payload.text).not.toContain(secret);
  expect(payload.filename).toBe('21life-recap-2026-11-21-2026-11-27.txt');
});
it('includes names only when explicitly enabled, with alias fallback for unnamed players', () => {
  const named = {...summary, players: summary.players.map((player, index) => ({...player, displayName: index === 0 ? null : player.displayName}))};
  const payload = createArenaRecapPayload(named, period, {groupName: 'Pod', language: 'en', includeNames: true}, formatGameDuration);
  expect(payload.text).toContain('Alice'); expect(payload.text).toContain('Player 1'); expect(payload.text).not.toContain('Bob');
  expect(createArenaRecapPayload(named, period, {groupName: 'Pod', language: 'en', includeNames: false}, formatGameDuration).text).not.toContain('Alice');
});
it('shows zero matches and unavailable duration without inventing zero-length measurements', () => {
  const payload = createArenaRecapPayload(summarizeArenaRecap([]), period, {groupName: '', language: 'en', includeNames: false}, formatGameDuration);
  expect(payload.title).toBe('Playgroup - 21Life'); expect(payload.text).toContain('Completed games: 0');
  expect(payload.text).toContain('Distinct players: 0'); expect(payload.text).toContain('Median duration: Data unavailable');
  expect(payload.text).not.toContain('0s');
});
it('qualifies unknown historical identities/results and incomplete commander coverage', () => {
  const payload = createArenaRecapPayload({...summary, distinctPlayers: null, identityDataIncomplete: true,
    commanderDataIncomplete: true, unknownResults: 1, wins: 0}, period, {groupName: 'Pod', language: 'en', includeNames: false}, formatGameDuration);
  expect(payload.text).toContain('Distinct players: Data unavailable');
  expect(payload.text).toContain('unavailable results: 1'); expect(payload.text).toContain('known commanders');
});
it('bounds visible player names and reports the remainder without truncating underlying totals', () => {
  const many = {...summary, distinctPlayers: 25, players: Array.from({length: 25}, (_, index) => ({alias: index + 1,
    displayName: `User ${index}`, gamesPlayed: 1, wins: 0, draws: 0}))};
  const payload = createArenaRecapPayload(many, period, {groupName: 'Pod', language: 'en', includeNames: false}, formatGameDuration);
  expect(payload.text).toContain('Distinct players: 25'); expect(payload.text).toContain('Player 20:');
  expect(payload.text).not.toContain('Player 21:'); expect(payload.text).toContain('and 5 more players');
});
it('does not allow group labels to inject extra lines or unbounded titles/filenames', () => {
  const payload = createArenaRecapPayload(summary, period, {groupName: 'Pod\nEXTRA', language: 'it', includeNames: false}, formatGameDuration);
  expect(payload.title).toBe('Pod EXTRA - 21Life'); expect(payload.text.startsWith('Pod EXTRA · 21Life\n')).toBe(true);
  expect(payload.filename).not.toContain('EXTRA');
});
