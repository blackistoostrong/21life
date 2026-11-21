import { afterEach, describe, expect, it, vi } from 'vitest';
import { withLiveGameTimeout, withLiveGameRequestTimeout } from '@/lib/live-game-async';

describe('live game foreground timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('returns completed operations normally', async () => {
    await expect(withLiveGameTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('releases the UI when a network operation never settles', async () => {
    vi.useFakeTimers();
    const result = withLiveGameTimeout(new Promise<never>(() => undefined), 1_000);
    const assertion = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('aborts a stalled sync request and permits a fresh retry', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const request = { abortSignal: (value: AbortSignal) => { signal = value; return new Promise<never>(() => undefined); } };
    const result = withLiveGameRequestTimeout(request, 1_000);
    const assertion = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(signal?.aborted).toBe(true);
    await expect(withLiveGameRequestTimeout({ abortSignal: () => Promise.resolve('retried') })).resolves.toBe('retried');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a request on context change and removes timeout/listener resources', async () => {
    vi.useFakeTimers();
    const external = new AbortController();
    const remove = vi.spyOn(external.signal,'removeEventListener');
    let transport: AbortSignal | undefined;
    const operation = withLiveGameRequestTimeout({ abortSignal: signal => { transport=signal; return new Promise<never>(()=>undefined); } },15000,external.signal);
    const assertion=expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    external.abort(); await assertion;
    expect(transport?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));
  });
  it('does not start transport for an already cancelled context', async () => {
    const controller = new AbortController(); controller.abort();
    const request = { abortSignal: vi.fn() };
    await expect(withLiveGameRequestTimeout(request,15000,controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request.abortSignal).not.toHaveBeenCalled();
  });
});
