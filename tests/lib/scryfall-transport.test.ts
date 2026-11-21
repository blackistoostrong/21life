import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScryfallTransport } from '../../packages/data/scryfall-transport';

const url = (name: string) => `https://api.scryfall.com/cards/named?exact=${name}`;
const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });
const tick = () => vi.advanceTimersByTimeAsync(0);

describe('shared Scryfall transport', () => {
  afterEach(() => vi.useRealTimers());

  it('spaces starts across different endpoints without serializing slow responses', async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    let finishFirst!: (response: Response) => void;
    const fetcher = vi.fn(async () => {
      starts.push(Date.now());
      if (starts.length === 1) return new Promise<Response>((resolve) => { finishFirst = resolve; });
      return json({ name: 'card' });
    });
    const client = createScryfallTransport({ fetch: fetcher });
    const requests = [client(url('a')), client('https://api.scryfall.com/cards/search?q=b'), client(url('c'))];
    await tick();
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(starts).toHaveLength(3);
    finishFirst(json({ name: 'first card' }));
    await Promise.all(requests);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(550);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(550);
  });

  it('deduplicates inflight requests with independent readable response bodies and cache hits', async () => {
    const fetcher = vi.fn(async () => json({ name: 'card' }));
    const client = createScryfallTransport({ fetch: fetcher });
    const responses = await Promise.all([client(url('a')), client(url('a'))]);
    expect(await responses[0].json()).toEqual({ name: 'card' });
    expect(await responses[1].json()).toEqual({ name: 'card' });
    expect(await (await client(url('a'))).json()).toEqual({ name: 'card' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('aborting one subscriber preserves the shared request for another', async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const client = createScryfallTransport({ fetch: fetcher });
    const controller = new AbortController();
    const first = client(url('a'), controller.signal);
    const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = client(url('a'));
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    await rejection;
    expect(fetcher.mock.calls[0]).toBeDefined();
    complete(json({ ok: true }));
    expect((await second).status).toBe(200);
  });

  it('drops cancelled queue entries and does not fetch them', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => json({}));
    const client = createScryfallTransport({ fetch: fetcher });
    await client(url('first'));
    const controller = new AbortController();
    const pending = client(url('cancelled'), controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejection;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['2', new Date(2_000).toUTCString()])('respects Retry-After %s across requests', async (retryAfter) => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 429, { 'retry-after': retryAfter }))
      .mockImplementation(async () => json({ ok: true }));
    const client = createScryfallTransport({ fetch: fetcher });
    const first = client(url('limited'));
    await tick();
    const other = client(url('other'));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([first, other]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('bounds retries, never caches transient failures, and recovers', async () => {
    const fetcher = vi.fn(async () => json({}, 503));
    const client = createScryfallTransport({ fetch: fetcher, intervalMs: 0 });
    vi.useFakeTimers();
    const failed = client(url('a'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await failed).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockImplementation(async () => json({ recovered: true }));
    const recovered = client(url('a'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await recovered).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('deadline aborts a fetch which ignores its signal', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    const client = createScryfallTransport({ fetch: fetcher, timeoutMs: 100 });
    const pending = client(url('a'));
    const rejection = expect(pending).rejects.toThrow('Scryfall request timed out');
    await vi.advanceTimersByTimeAsync(100); await rejection;
    expect(fetcher.mock.calls[0]).toBeDefined();
  });

  it('expires negative cache and evicts oldest entries', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => json({}, 404));
    const client = createScryfallTransport({ fetch: fetcher, intervalMs: 0, cacheLimit: 1 });
    await client(url('a')); await client(url('a'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_001); await client(url('a'));
    await client(url('b')); await client(url('a'));
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('rejects pre-aborted requests and non-card API or foreign URLs', async () => {
    const fetcher = vi.fn();
    const client = createScryfallTransport({ fetch: fetcher });
    const controller = new AbortController(); controller.abort();
    await expect(client(url('a'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    for (const target of ['http://api.scryfall.com/cards/a', 'https://evil.test/cards/a',
      'https://api.scryfall.com/bulk-data', 'https://user@api.scryfall.com/cards/a']) {
      await expect(client(target)).rejects.toThrow('Unsupported Scryfall URL');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('identifies server/native requests and lets browsers supply User-Agent', async () => {
    const observedHeaders: unknown[] = [];
    const fetcher = vi.fn(async (_input: unknown, init?: { headers?: unknown }) => {
      observedHeaders.push(init?.headers);
      return json({});
    });
    const client = createScryfallTransport({ fetch: fetcher, intervalMs: 0 });
    await client(url('server'));
    expect(observedHeaders[0]).toMatchObject({ Accept: 'application/json',
      'User-Agent': '21Life/9.3.0 (support@21life.win)' });
    vi.stubGlobal('document', {});
    try {
      await client(url('browser'));
      expect(observedHeaders[1]).toEqual({ Accept: 'application/json' });
    } finally { vi.unstubAllGlobals(); }
  });
});
