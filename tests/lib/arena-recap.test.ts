import {expect, it} from 'vitest';
import {cleanArenaRecapLabel, summarizeArenaRecap, type ArenaRecapMatch, type ArenaRecapParticipant} from '@/lib/arena-recap';

const alice: ArenaRecapParticipant = {identity: 'user:a', displayName: 'Alice', commander: 'Alpha', isWinner: true};
const bob: ArenaRecapParticipant = {identity: 'guest:b', displayName: 'Bob', commander: 'Beta', isWinner: false};
const match = (id: string, changes: Partial<ArenaRecapMatch> = {}): ArenaRecapMatch => ({
  id, playedAt: '2026-11-27T12:00:00Z', isDraw: false, durationSeconds: 60, trackingVersion: 1,
  participants: [alice, bob], ...changes,
});
it('represents zero completed games without fabricated players, duration or wins', () => {
  expect(summarizeArenaRecap([])).toMatchObject({totalMatches: 0, wins: 0, draws: 0, unknownResults: 0,
    distinctPlayers: 0, players: [], topCommanders: [], medianDurationSeconds: null, durationSample: 0});
});
it('counts completed games, guests, draws and commander appearances independently of winners', () => {
  const report = summarizeArenaRecap([match('1'), match('2', {isDraw: true, durationSeconds: 180,
    participants: [{...alice, isWinner: false}, bob]}), match('3', {durationSeconds: 120,
    participants: [{...alice, isWinner: false}, {...bob, isWinner: true}]})]);
  expect(report).toMatchObject({totalMatches: 3, wins: 2, draws: 1, distinctPlayers: 2,
    medianDurationSeconds: 120, durationSample: 3, identityDataIncomplete: false, commanderDataIncomplete: false});
  expect(report.players).toEqual([
    {alias: 1, displayName: 'Bob', gamesPlayed: 3, wins: 1, draws: 1},
    {alias: 2, displayName: 'Alice', gamesPlayed: 3, wins: 1, draws: 1},
  ]);
  expect(JSON.stringify(report)).not.toContain('user:a'); expect(JSON.stringify(report)).not.toContain('guest:b');
});
it('keeps draw-only and unresolved historical results distinct from wins', () => {
  const report = summarizeArenaRecap([match('1', {isDraw: true, participants: [{...alice, isWinner: false}, bob]}),
    match('2', {isDraw: null, participants: [{...alice, isWinner: false}, bob]})]);
  expect(report).toMatchObject({totalMatches: 2, wins: 0, draws: 1, unknownResults: 1});
});
it('does not infer distinct historical identities or commanders from missing records', () => {
  const report = summarizeArenaRecap([match('1', {participants: [{...alice, identity: null, commander: null}, bob]}),
    match('2', {participants: []})]);
  expect(report).toMatchObject({distinctPlayers: null, identityDataIncomplete: true, commanderDataIncomplete: true});
  expect(report.players).toHaveLength(1); expect(report.topCommanders).toEqual([{commander: 'Beta', appearances: 1}]);
});
it('selects at most three commanders with deterministic ties and stable aliases under input reordering', () => {
  const games = [match('1'), match('2', {participants: [{...alice, commander: 'Delta'}, {...bob, commander: 'Gamma'}]})];
  const forward = summarizeArenaRecap(games), reverse = summarizeArenaRecap([...games].reverse());
  expect(forward).toEqual(reverse);
  expect(forward.topCommanders.map(row => row.commander)).toEqual(['Alpha', 'Beta', 'Delta']);
});
it('groups harmless commander casing differences while counting both same-commander seats', () => {
  const report = summarizeArenaRecap([match('1', {participants: [alice, {...bob, commander: 'alpha'}]})]);
  expect(report.topCommanders).toEqual([{commander: 'Alpha', appearances: 2}]);
});
it('uses the latest historical name by instant, not ISO offset spelling or iteration order', () => {
  const games = [match('1', {playedAt: '2026-11-27T12:00:00+02:00'}),
    match('2', {playedAt: '2026-11-27T11:00:00Z', participants: [{...alice, displayName: 'New Alice'}, bob]})];
  expect(summarizeArenaRecap(games)).toEqual(summarizeArenaRecap([...games].reverse()));
  expect(summarizeArenaRecap(games).players[1].displayName).toBe('New Alice');
});
it('resolves equal-time names deterministically and never replaces a name with an empty label', () => {
  const games = [match('1'), match('2', {participants: [{...alice, displayName: 'Later'}, bob]}),
    match('3', {participants: [{...alice, displayName: '  '}, bob]})];
  expect(summarizeArenaRecap(games)).toEqual(summarizeArenaRecap([...games].reverse()));
  expect(summarizeArenaRecap(games).players[1].displayName).toBe('Later');
});
it('retains PostgreSQL microsecond ordering when choosing a historical name', () => {
  const games = [match('1', {playedAt: '2026-11-27T12:00:00.000002Z', participants: [{...alice, displayName: 'Newest'}, bob]}),
    match('2', {playedAt: '2026-11-27T12:00:00.000001Z'})];
  expect(summarizeArenaRecap(games).players[1].displayName).toBe('Newest');
});
it('excludes unknown legacy/manual zero durations but preserves explicit positive and tracked-zero durations', () => {
  const report = summarizeArenaRecap([
    match('1', {durationSeconds: null}), match('2', {durationSeconds: 0, trackingVersion: null}),
    match('3', {durationSeconds: 0, trackingVersion: 1}), match('4', {durationSeconds: 120, trackingVersion: null}),
  ]);
  expect(report).toMatchObject({medianDurationSeconds: 60, durationSample: 2});
});
it.each([-1, 1.5, NaN, Infinity])('rejects invalid measured duration %s instead of inventing a median', value => {
  expect(() => summarizeArenaRecap([match('1', {durationSeconds: value})])).toThrow('ARENA_RECAP_CONTRACT_INVALID');
});
it.each([-1, 1.5, NaN, Infinity])('rejects invalid tracking provenance %s', value => {
  expect(() => summarizeArenaRecap([match('1', {trackingVersion: value})])).toThrow('ARENA_RECAP_CONTRACT_INVALID');
});
it('rejects duplicate matches, duplicate seat identities, conflicting winners and invalid timestamps', () => {
  for (const games of [
    [match('1'), match('1')], [match('1', {participants: [alice, {...bob, identity: alice.identity}]})],
    [match('1', {participants: [alice, {...bob, isWinner: true}]})], [match('1', {isDraw: true})],
    [match('1', {playedAt: 'invalid'})],
  ]) expect(() => summarizeArenaRecap(games)).toThrow('ARENA_RECAP_CONTRACT_INVALID');
});
it('normalizes bounded labels without injected lines or broken Unicode code points', () => {
  expect(cleanArenaRecapLabel('  Pod\n\t\u2028SECRET\u0000 name  ')).toBe('Pod SECRET name');
  expect(Array.from(cleanArenaRecapLabel('🧙'.repeat(161)))).toHaveLength(160);
});
