import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWhenIdle } from '@/lib/idle-work';

describe('idle-work', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs tasks immediately outside the browser', async () => {
    const task = vi.fn();

    const dispose = runWhenIdle(task);
    dispose(); dispose();

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('falls back to setTimeout when requestIdleCallback is unavailable', () => {
    vi.useFakeTimers();

    const task = vi.fn();
    const originalWindow = globalThis.window;

    vi.stubGlobal('window', {
      setTimeout,
    } as Window & typeof globalThis);

    runWhenIdle(task, { timeoutMs: 1000 });
    expect(task).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalledTimes(1);

    vi.stubGlobal('window', originalWindow);
  });

  it('cancels native idle work once and ignores a callback delivered after cancellation', () => {
    let deliver = () => {};
    const request = vi.fn((callback: () => void) => { deliver = callback; return 7; });
    const cancel = vi.fn();
    vi.stubGlobal('window', { requestIdleCallback: request, cancelIdleCallback: cancel });
    const task = vi.fn();
    const dispose = runWhenIdle(task, { timeoutMs: 6000 });
    expect(request).toHaveBeenCalledWith(expect.any(Function), { timeout: 6000 });
    dispose(); dispose(); deliver();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(7);
    expect(task).not.toHaveBeenCalled();
  });

  it('does not cancel an idle task which already ran', () => {
    let deliver = () => {};
    const cancel = vi.fn();
    vi.stubGlobal('window', { requestIdleCallback: (callback: () => void) => { deliver = callback; return 8; }, cancelIdleCallback: cancel });
    const task = vi.fn();
    const dispose = runWhenIdle(task);
    deliver(); deliver(); dispose();
    expect(task).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('removes its fallback timer instead of keeping queued work after disposal', () => {
    vi.useFakeTimers(); vi.stubGlobal('window', {});
    const task = vi.fn();
    const dispose = runWhenIdle(task, { timeoutMs: 6000 });
    expect(vi.getTimerCount()).toBe(1);
    dispose(); dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(6000);
    expect(task).not.toHaveBeenCalled();
  });
});
