import {expect, it, vi} from 'vitest';
import {projectArenaRecapMatches, readArenaRecap} from '@/lib/arena-recap';
import {arenaHistoryScope, parseArenaHistoryPage} from '../../packages/domain/arena-history';
import {historyGroup, historyId, historyMatch, historyPageFixture} from '../fixtures/arena-history';

const period = {days: 7 as const, since: '2010-01-01T00:00:00Z', until: '2010-01-08T00:00:00Z', firstDay: '2010-01-01', lastDay: '2010-01-07', timeZone: 'UTC'};
function fixture(overrides: Record<string, unknown> = {}, matchOverrides: Record<string, unknown> = {}) {
  const participant = {id: historyId(20), match_id: historyId(1), user_id: historyId(2), guest_id: null,
    deck_id: historyId(3), guest_deck_id: null, is_winner: true,
    participant_name_snapshot: 'Alice historical', commander_snapshot: 'Historical Commander',
    profiles: {display_name: 'Alice current', username: 'alice', email: 'secret@example.test'},
    decks: {name: 'Private Deck', commander: 'Current Commander', source_url: 'https://private.example/deck'},
    ...overrides};
  const row = {...historyMatch(1, '2010-01-02T06:00:00Z', '2010-01-02'), is_draw: false, duration_seconds: 120,
    tracking_version: null, notes: 'PRIVATE_NOTES', invite_code: 'PRIVATE_CODE', live_game_log: ['PRIVATE_LOG'],
    match_participants: [participant], ...matchOverrides};
  const data = {...historyPageFixture(), total: 1, matches: [row], filters: {since: period.since, until: period.until, dayKey: null, boundaryHour: 0}};
  const parsed = parseArenaHistoryPage(data, arenaHistoryScope(historyGroup, {...period, boundaryHour: 0}));
  return {data, matches: parsed.matches};
}
it('projects only selected metadata from a real parsed v2 payload and preserves deleted-deck snapshots', () => {
  const {matches} = fixture({deck_id: null, decks: null});
  const projected = projectArenaRecapMatches(matches);
  expect(projected[0].participants[0]).toEqual({identity: `user:${historyId(2)}`, displayName: 'Alice historical',
    commander: 'Historical Commander', isWinner: true});
  for (const secret of ['PRIVATE_NOTES', 'PRIVATE_CODE', 'PRIVATE_LOG', 'secret@example.test', 'private.example', 'Private Deck']) {
    expect(JSON.stringify(projected)).not.toContain(secret);
  }
});
it('uses existing guest/profile and deck fallbacks only when snapshots are absent', () => {
  const guest = fixture({user_id: null, guest_id: historyId(4), participant_name_snapshot: null,
    commander_snapshot: null, arena_guests: {display_name: 'Guest'}, decks: null, arena_guest_decks: {commander: 'Guest Commander'}});
  expect(projectArenaRecapMatches(guest.matches)[0].participants[0]).toMatchObject({identity: `guest:${historyId(4)}`,
    displayName: 'Guest', commander: 'Guest Commander'});
  const user = fixture({participant_name_snapshot: '', commander_snapshot: '', profiles: {display_name: ' ', username: 'handle'}});
  expect(projectArenaRecapMatches(user.matches)[0].participants[0]).toMatchObject({displayName: 'handle', commander: 'Current Commander'});
});
it('leaves unknown historical identities and commander labels explicitly missing', () => {
  const {matches} = fixture({user_id: null, guest_id: null, participant_name_snapshot: null, profiles: null,
    commander_snapshot: null, decks: null});
  expect(projectArenaRecapMatches(matches)[0].participants[0]).toMatchObject({identity: null, displayName: null, commander: null});
});
it.each([
  {participant_name_snapshot: 12}, {profiles: [] , participant_name_snapshot: null},
  {commander_snapshot: {}}, {guest_id: historyId(4)},
])('rejects malformed or ambiguous selected metadata', overrides => {
  expect(() => projectArenaRecapMatches(fixture(overrides).matches)).toThrow('ARENA_RECAP_CONTRACT_INVALID');
});
it.each([{duration_seconds: -1}, {duration_seconds: '120'}, {tracking_version: 1.5}])('rejects invalid duration provenance', overrides => {
  expect(() => projectArenaRecapMatches(fixture({}, overrides).matches)).toThrow('ARENA_RECAP_CONTRACT_INVALID');
});
it('does not invent optional duration/tracking metadata absent from older rows', () => {
  const projected = projectArenaRecapMatches(fixture({}, {duration_seconds: undefined, tracking_version: undefined}).matches);
  expect(projected[0]).toMatchObject({durationSeconds: null, trackingVersion: null});
});
it('reads the complete acknowledged period before producing an identifier-free aggregate', async () => {
  const {data} = fixture();
  const client = {rpc: vi.fn(() => ({abortSignal: async () => ({data, error: null})}))};
  const summary = await readArenaRecap(client, historyGroup, period);
  expect(summary).toMatchObject({totalMatches: 1, wins: 1, distinctPlayers: 1, medianDurationSeconds: 120});
  for (const secret of [historyId(1), historyId(2), historyGroup, 'PRIVATE_NOTES', 'PRIVATE_CODE', 'secret@example.test']) {
    expect(JSON.stringify(summary)).not.toContain(secret);
  }
  expect(client.rpc).toHaveBeenCalledOnce();
});
it('never returns a successful summary after transport or completeness failure', async () => {
  const client = {rpc: () => ({abortSignal: async () => ({data: null, error: {code: '42501'}})})};
  await expect(readArenaRecap(client, historyGroup, period)).rejects.toThrow('ARENA_HISTORY_FORBIDDEN');
});
