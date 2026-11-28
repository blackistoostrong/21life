import {expect, it, vi} from 'vitest';
import {createArenaRecapController} from '@/lib/arena-recap-controller';
import {createArenaRecapPayload} from '@/lib/arena-recap-text';
import {summarizeArenaRecap} from '@/lib/arena-recap';
import {formatGameDuration} from '@/lib/live-game-duration';
import type {ArenaRecapPeriod} from '../../packages/domain/arena-recap-period';

const scope = {accountId: 'alice', groupId: 'pod'};
const summary = summarizeArenaRecap([{id: '1', playedAt: '2026-11-27T10:00:00Z', isDraw: false, durationSeconds: 120,
  trackingVersion: 1, participants: [{identity: 'user:alice', displayName: 'Alice', commander: 'Commander A', isWinner: true}]}]);
function fixture() {
  const ports = {
    now: () => new Date('2026-11-27T12:00:00Z'),
    read: vi.fn(async (_period: ArenaRecapPeriod, _signal: AbortSignal) => summary),
    makePayload: vi.fn((report: typeof summary, period: ArenaRecapPeriod, includeNames: boolean) =>
      createArenaRecapPayload(report, period, {groupName: 'Pod', language: 'en', includeNames}, formatGameDuration)),
    share: vi.fn(async () => 'opened' as 'opened' | 'cancelled'), copy: vi.fn(async () => {}), download: vi.fn(async () => {}),
  };
  const owner = createArenaRecapController(scope); owner.bind(scope, ports); owner.activate();
  return {owner, ports};
}
it('opens an anonymous seven-day preview without any export and resets privacy on reopening', async () => {
  const {owner, ports} = fixture(); expect(ports.read).not.toHaveBeenCalled();
  expect(await owner.open()).toBe(true); expect(owner.view.getSnapshot()).toMatchObject({open: true, days: 7, includeNames: false, summary});
  expect(ports.share).not.toHaveBeenCalled(); expect(ports.copy).not.toHaveBeenCalled(); expect(ports.download).not.toHaveBeenCalled();
  owner.setIncludeNames(true); owner.close(); expect(owner.view.getSnapshot()).toMatchObject({open: false, summary: null, includeNames: false});
  await owner.open(); expect(owner.view.getSnapshot().includeNames).toBe(false);
});
it('calls the platform synchronously in the gesture and exports the current privacy choice only once', async () => {
  const {owner, ports} = fixture(); await owner.open(); owner.setIncludeNames(true); owner.setIncludeNames(false);
  let release!: () => void; ports.copy.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
  const pending = owner.exportText('copy'); expect(ports.copy).toHaveBeenCalledOnce();
  expect(ports.makePayload.mock.calls[0][2]).toBe(false); expect(ports.makePayload.mock.results[0].value.text).not.toContain('Alice');
  expect(await owner.exportText('share')).toBe(false); expect(ports.share).not.toHaveBeenCalled();
  expect(owner.view.getSnapshot().feedback).toBeNull(); release(); expect(await pending).toBe(true);
  expect(owner.view.getSnapshot().feedback).toBe('copied');
});
it('does not report failed clipboard writes as copied and permits an explicit retry', async () => {
  const {owner, ports} = fixture(); await owner.open(); ports.copy.mockRejectedValueOnce(new Error('Denied'));
  expect(await owner.exportText('copy')).toBe(false); expect(owner.view.getSnapshot()).toMatchObject({error: 'copy', feedback: null});
  expect(await owner.exportText('copy')).toBe(true); expect(owner.view.getSnapshot()).toMatchObject({error: null, feedback: 'copied'});
});
it('treats native dismissal and Web Share cancellation as neutral, without claiming publication', async () => {
  const {owner, ports} = fixture(); await owner.open(); ports.share.mockResolvedValueOnce('cancelled');
  expect(await owner.exportText('share')).toBe(false); expect(owner.view.getSnapshot()).toMatchObject({error: null, feedback: null});
  ports.share.mockRejectedValueOnce(Object.assign(new Error('Cancelled'), {name: 'AbortError'}));
  expect(await owner.exportText('share')).toBe(false); expect(owner.view.getSnapshot()).toMatchObject({error: null, feedback: null});
  expect(await owner.exportText('share')).toBe(true); expect(owner.view.getSnapshot().feedback).toBeNull();
});
it('acknowledges only download initiation and refuses exports without a ready preview', async () => {
  const {owner, ports} = fixture(); expect(await owner.exportText('download')).toBe(false); expect(ports.download).not.toHaveBeenCalled();
  await owner.open(); expect(await owner.exportText('download')).toBe(true); expect(owner.view.getSnapshot().feedback).toBe('downloaded');
});
it('cancels an old period read and ignores its late result when switching to thirty days', async () => {
  const {owner, ports} = fixture(); let release!: (value: typeof summary) => void;
  ports.read.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
  const first = owner.open(), signal = ports.read.mock.calls[0][1];
  expect(await owner.setDays(30)).toBe(true); expect(signal.aborted).toBe(true);
  release({...summary, totalMatches: 999}); expect(await first).toBe(false);
  expect(owner.view.getSnapshot()).toMatchObject({days: 30, summary});
  expect(await owner.setDays(30)).toBe(false); expect(ports.read).toHaveBeenCalledTimes(2);
});
for (const transition of ['close', 'deactivate'] as const) it(`ignores a late read after ${transition}`, async () => {
  const {owner, ports} = fixture(); let release!: (value: typeof summary) => void;
  ports.read.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
  const pending = owner.open(), signal = ports.read.mock.calls[0][1]; owner[transition](); release(summary);
  expect(await pending).toBe(false); expect(signal.aborted).toBe(true);
  expect(owner.view.getSnapshot()).toMatchObject({open: false, summary: null, feedback: null});
});
it('does not apply export feedback to another opening or account after late acknowledgement', async () => {
  const {owner, ports} = fixture(); await owner.open(); let release!: () => void;
  ports.copy.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
  const pending = owner.exportText('copy'); owner.close(); await owner.open(); release();
  expect(await pending).toBe(false); expect(owner.view.getSnapshot()).toMatchObject({open: true, feedback: null, includeNames: false});
});
it('keeps accepted command callbacks stable across same-scope rebinding and rejects another scope', async () => {
  const {owner, ports} = fixture(); await owner.open(); let release!: () => void;
  ports.copy.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
  const pending = owner.exportText('copy'), replacement = {...ports, copy: vi.fn(async () => {})};
  owner.bind(scope, replacement); expect(() => owner.bind({...scope, accountId: 'bob'}, replacement)).toThrow('ARENA_RECAP_SCOPE_CHANGED');
  release(); expect(await pending).toBe(true); expect(replacement.copy).not.toHaveBeenCalled();
});
it.each([
  ['ARENA_HISTORY_CHANGED', 'changed'], ['ARENA_HISTORY_FORBIDDEN', 'forbidden'],
  ['ARENA_HISTORY_TOO_LARGE', 'too_large'], ['raw backend error', 'unavailable'],
])('maps %s to a safe preview error without manufacturing data', async (code, expected) => {
  const {owner, ports} = fixture(); ports.read.mockRejectedValueOnce(new Error(code));
  expect(await owner.open()).toBe(false); expect(owner.view.getSnapshot()).toMatchObject({error: expected, summary: null});
  expect(await owner.retry()).toBe(true); expect(owner.view.getSnapshot().error).toBeNull();
});
it('does not launch an export if its opening closes while pending state is being published', async () => {
  const {owner, ports} = fixture(); await owner.open();
  const unsubscribe = owner.view.subscribe(() => {if (owner.view.getSnapshot().pending === 'share') owner.close();});
  expect(await owner.exportText('share')).toBe(false); expect(ports.share).not.toHaveBeenCalled(); unsubscribe();
});
