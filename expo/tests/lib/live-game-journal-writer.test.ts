import { describe, expect, it, vi } from 'vitest';
import { queueLiveGameJournalWrite } from '@/lib/live-game-journal-writer';

describe('native durable journal writer', () => {
  it('enqueues every snapshot immediately and reports durability after earlier accepted writes resolve', async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const write = vi.fn(async () => undefined);
    const onResult = vi.fn();
    const first = queueLiveGameJournalWrite(Promise.resolve(), () => gate, onResult);
    const second = queueLiveGameJournalWrite(first,write,onResult);
    await Promise.resolve(); await Promise.resolve();
    expect(write).toHaveBeenCalledOnce(); expect(onResult).not.toHaveBeenCalled();
    finish(); await second;
    expect(write).toHaveBeenCalledOnce(); expect(onResult.mock.calls).toEqual([[true],[true]]);
  });
  it('preserves rejection for destructive callers and allows a later retry', async () => {
    const onResult = vi.fn();
    const failed = queueLiveGameJournalWrite(Promise.resolve(),async () => { throw new Error('Quota'); },onResult);
    await expect(failed).rejects.toThrow('Quota');
    await queueLiveGameJournalWrite(failed,async () => undefined,onResult);
    expect(onResult.mock.calls).toEqual([[false],[true]]);
  });
  it('also reports a synchronously thrown storage error', async () => {
    const onResult = vi.fn();
    await expect(queueLiveGameJournalWrite(Promise.resolve(),() => { throw new Error('Storage denied'); },onResult)).rejects.toThrow('Storage denied');
    expect(onResult).toHaveBeenCalledWith(false);
  });
});
