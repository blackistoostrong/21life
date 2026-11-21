import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeToArenaCatalog as web } from '../../lib/arena-catalog-realtime';
import { subscribeToArenaCatalog as native } from '../../expo/lib/arena-catalog-realtime';

function clientFixture() {
  let receive!: (message: { payload: unknown }) => void;
  const channel = { on: vi.fn(), subscribe: vi.fn(), teardown: vi.fn() };
  channel.on.mockImplementation((_type, _filter, callback) => { receive = callback; return channel; });
  const client = { channel: vi.fn(() => channel), realtime: { setAuth: vi.fn().mockResolvedValue(undefined) }, removeChannel: vi.fn().mockResolvedValue('ok') };
  return { client: client as unknown as Parameters<typeof web>[0] & Parameters<typeof native>[0], channel, remove: client.removeChannel,
    auth: client.realtime.setAuth, open: client.channel,
    emit: (entity: string, id = entity) => receive({ payload: { entity, id, operation: 'UPDATE' } }),
    raw: (payload: unknown) => receive({ payload }) };
}
for (const [platform, subscribe] of [['web', web], ['native', native]] as const) describe(`${platform} arena catalog invalidation`, () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('preserves every changed entity in a mixed burst', async () => {
    const fixture = clientFixture(); const changed = vi.fn();
    const dispose = subscribe(fixture.client, 'group', changed); await Promise.resolve();
    fixture.emit('member'); fixture.emit('guest'); fixture.emit('deck');
    vi.advanceTimersByTime(120);
    expect(changed.mock.calls.map(([event]) => event.entity)).toEqual(['member', 'guest', 'deck']);
    expect(changed).toHaveBeenNthCalledWith(1, { entity: 'member', id: 'member', operation: 'UPDATE' });
    dispose();
  });
  it('flushes within the first window even while more events arrive', async () => {
    const fixture = clientFixture(); const changed = vi.fn();
    const dispose = subscribe(fixture.client, 'group', changed); await Promise.resolve();
    fixture.emit('deck'); vi.advanceTimersByTime(100); fixture.emit('guest'); vi.advanceTimersByTime(20);
    expect(changed).toHaveBeenCalledTimes(2); dispose();
  });
  it('does not retain timers or deliver notifications after disposal', async () => {
    const fixture = clientFixture(); const changed = vi.fn();
    const dispose = subscribe(fixture.client, 'group', changed); await Promise.resolve();
    fixture.emit('deck'); dispose(); fixture.emit('guest');
    expect(vi.getTimerCount()).toBe(0); expect(changed).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fixture.remove).toHaveBeenCalledTimes(1));
  });
  it('ignores malformed or unknown payloads', async () => {
    const fixture = clientFixture(); const changed = vi.fn();
    const dispose = subscribe(fixture.client, 'group', changed); await Promise.resolve();
    fixture.raw(null); fixture.raw({ entity: 'unknown', id: 'x', operation: 'UPDATE' });
    fixture.raw({ entity: 'deck', id: '', operation: 'UPDATE' });
    vi.advanceTimersByTime(120); expect(changed).not.toHaveBeenCalled(); dispose();
  });
});

describe('shared channel leases', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('shares a channel across simultaneous screens until the final owner leaves', async () => {
    const fixture = clientFixture(), first = vi.fn(), second = vi.fn();
    const stopFirst = web(fixture.client, 'group', first, { scopeKey: 'account' });
    const stopSecond = native(fixture.client, 'group', second, { scopeKey: 'account' });
    await vi.waitFor(() => expect(fixture.channel.subscribe).toHaveBeenCalledTimes(1));
    expect(fixture.open).toHaveBeenCalledTimes(1);
    fixture.emit('deck'); vi.advanceTimersByTime(120);
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
    stopFirst(); expect(fixture.remove).not.toHaveBeenCalled();
    fixture.emit('guest'); vi.advanceTimersByTime(120);
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(2);
    stopSecond(); await vi.waitFor(() => expect(fixture.remove).toHaveBeenCalledTimes(1));
  });
  it('waits for old account removal before opening the same topic for a new account', async () => {
    const fixture = clientFixture(), first = vi.fn(), second = vi.fn();
    let release!: () => void;
    fixture.remove.mockReturnValueOnce(new Promise(resolve => { release = () => resolve('ok'); }));
    const stopFirst = web(fixture.client, 'group', first, { scopeKey: 'A' });
    await vi.waitFor(() => expect(fixture.channel.subscribe).toHaveBeenCalledTimes(1));
    const oldReceive = fixture.channel.on.mock.calls[0][2] as (message: { payload: unknown }) => void;
    const stopSecond = web(fixture.client, 'group', second, { scopeKey: 'B' });
    await vi.waitFor(() => expect(fixture.remove).toHaveBeenCalledTimes(1));
    expect(fixture.open).toHaveBeenCalledTimes(1);
    release(); await vi.waitFor(() => expect(fixture.open).toHaveBeenCalledTimes(2));
    oldReceive({ payload: { entity: 'member', id: 'old', operation: 'UPDATE' } });
    fixture.emit('deck'); vi.advanceTimersByTime(120);
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1);
    stopFirst(); expect(fixture.remove).toHaveBeenCalledTimes(1);
    stopSecond(); await vi.waitFor(() => expect(fixture.remove).toHaveBeenCalledTimes(2));
  });
  it.each([['web', web], ['native', native]] as const)('%s forces teardown on SDK removal timeout before topic reuse', async (_platform, adapter) => {
    const fixture = clientFixture(); fixture.remove.mockResolvedValueOnce('timed out');
    const stopFirst = adapter(fixture.client, 'group', vi.fn(), { scopeKey: 'A' });
    await vi.waitFor(() => expect(fixture.channel.subscribe).toHaveBeenCalledTimes(1));
    const stopSecond = adapter(fixture.client, 'group', vi.fn(), { scopeKey: 'B' });
    await vi.waitFor(() => expect(fixture.open).toHaveBeenCalledTimes(2));
    expect(fixture.channel.teardown).toHaveBeenCalledTimes(1);
    expect(fixture.channel.teardown.mock.invocationCallOrder[0]).toBeLessThan(fixture.open.mock.invocationCallOrder[1]);
    stopFirst(); stopSecond();
  });
  it('releases local SDK state even when unsubscribe rejects', async () => {
    const fixture = clientFixture(); fixture.remove.mockRejectedValueOnce(new Error('Socket closed'));
    const stopFirst = native(fixture.client, 'group', vi.fn(), { scopeKey: 'A' });
    await vi.waitFor(() => expect(fixture.channel.subscribe).toHaveBeenCalledTimes(1));
    const stopSecond = native(fixture.client, 'group', vi.fn(), { scopeKey: 'B' });
    await vi.waitFor(() => expect(fixture.open).toHaveBeenCalledTimes(2));
    expect(fixture.channel.teardown).toHaveBeenCalledTimes(1);
    stopFirst(); stopSecond();
  });
  it('reports synchronous SDK setup failure and permits a fresh owner to recover', async () => {
    const fixture = clientFixture(); const failed = vi.fn();
    fixture.open.mockImplementationOnce(() => { throw new Error('SDK channel unavailable'); });
    const stopFirst = web(fixture.client, 'group', vi.fn(), { scopeKey: 'A', onError: failed });
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    const stopSecond = web(fixture.client, 'group', vi.fn(), { scopeKey: 'B' });
    await vi.waitFor(() => expect(fixture.channel.subscribe).toHaveBeenCalledTimes(1));
    stopFirst(); stopSecond();
  });
  it('does not subscribe after disposal while authentication is pending', async () => {
    const fixture = clientFixture(); let release!: () => void;
    fixture.auth.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    const stop = web(fixture.client, 'group', vi.fn());
    await vi.waitFor(() => expect(fixture.auth).toHaveBeenCalledTimes(1));
    stop(); await vi.waitFor(() => expect(fixture.remove).toHaveBeenCalledTimes(1));
    release(); await Promise.resolve(); expect(fixture.channel.subscribe).not.toHaveBeenCalled();
  });
  it('reports failed authentication without an unhandled promise or late callback', async () => {
    const fixture = clientFixture(); const failed = vi.fn();
    fixture.auth.mockRejectedValue(new Error('Auth unavailable'));
    const stop = web(fixture.client, 'group', vi.fn(), { onError: failed });
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(fixture.channel.subscribe).not.toHaveBeenCalled(); stop();
  });
  it('reports initial subscription, reconnect and late joining owners', async () => {
    const fixture = clientFixture(); const ready = vi.fn(), failed = vi.fn(), lateReady = vi.fn();
    const stop = web(fixture.client, 'group', vi.fn(), { onReady: ready, onError: failed });
    await vi.waitFor(() => expect(fixture.channel.subscribe).toHaveBeenCalledTimes(1));
    const status = fixture.channel.subscribe.mock.calls[0][0] as (value: string) => void;
    status('SUBSCRIBED'); expect(ready).toHaveBeenCalledTimes(1);
    const stopLate = native(fixture.client, 'group', vi.fn(), { onReady: lateReady });
    await vi.waitFor(() => expect(lateReady).toHaveBeenCalledTimes(1));
    status('CHANNEL_ERROR'); expect(failed).toHaveBeenCalledTimes(1);
    status('SUBSCRIBED'); expect(ready).toHaveBeenCalledTimes(2); expect(lateReady).toHaveBeenCalledTimes(2);
    status('CLOSED'); expect(failed).toHaveBeenCalledTimes(2);
    stop(); stopLate(); status('SUBSCRIBED'); expect(ready).toHaveBeenCalledTimes(2);
  });
});
