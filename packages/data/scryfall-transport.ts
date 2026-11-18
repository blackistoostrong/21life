import { withRequestDeadline } from './request-deadline';

type Snapshot = { body: string; status: number; headers: [string, string][] };
type Flight = { controller: AbortController; promise: Promise<Snapshot>; subscribers: number };
type Options = { fetch?: typeof fetch; intervalMs?: number; timeoutMs?: number; cacheLimit?: number };
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function aborted() {
  const error = new Error('Scryfall request aborted');
  error.name = 'AbortError';
  return error;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Public card metadata only. Limits apply to this runtime, not a distributed fleet. */
export function createScryfallTransport(options: Options = {}) {
  const intervalMs = options.intervalMs ?? 550;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const cacheLimit = options.cacheLimit ?? 128;
  const cache = new Map<string, { snapshot: Snapshot; expiresAt: number }>();
  const flights = new Map<string, Flight>();
  let queue = Promise.resolve();
  let nextStart = 0;

  async function permit(signal: AbortSignal) {
    const run = async () => {
      while (!signal.aborted && nextStart > Date.now()) await wait(nextStart - Date.now(), signal);
      if (signal.aborted) throw aborted();
      nextStart = Date.now() + intervalMs;
    };
    const turn = queue.then(run);
    queue = turn.catch(() => undefined);
    return turn;
  }

  async function request(url: string, signal: AbortSignal): Promise<Snapshot> {
    for (let attempt = 0; ; attempt += 1) {
      await permit(signal);
      // Browsers supply their own User-Agent; setting it can be rejected or
      // trigger a CORS preflight. Server/native requests identify the app.
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (typeof document === 'undefined') headers['User-Agent'] = '21Life/9.3.0 (support@21life.win)';
      const response = await (options.fetch ?? fetch)(url, {
        headers,
        signal,
      });
      if (RETRYABLE.has(response.status)) {
        const header = response.headers.get('retry-after');
        const seconds = header === null ? NaN : Number(header);
        const retryAt = Number.isFinite(seconds)
          ? Date.now() + Math.max(0, seconds * 1_000)
          : Date.parse(header ?? '');
        nextStart = Math.max(nextStart, Number.isFinite(retryAt) ? retryAt : Date.now() + 250 * 2 ** attempt);
      }
      // Read the body inside the deadline; each subscriber receives its own Response.
      const body = await response.text();
      if (!RETRYABLE.has(response.status) || attempt === 2) {
        return { body, status: response.status, headers: Array.from(response.headers.entries()) };
      }
    }
  }

  return async function fetchScryfall(url: string, signal?: AbortSignal): Promise<Response> {
    if (signal?.aborted) throw aborted();
    const parsed = new URL(url);
    if (parsed.origin !== 'https://api.scryfall.com' || parsed.username || parsed.password
      || !/^\/cards(?:\/|$)/.test(parsed.pathname)) throw new Error('Unsupported Scryfall URL');
    parsed.hash = '';
    const key = parsed.href;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return restore(cached.snapshot);
    cache.delete(key);
    let flight = flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      const created: Flight = { controller, subscribers: 0,
        promise: withRequestDeadline({ abortSignal: (deadlineSignal) => request(key, deadlineSignal) },
        timeoutMs, controller.signal, 'Scryfall request timed out').then((snapshot) => {
        if (!controller.signal.aborted && (snapshot.status === 200 || snapshot.status === 404)
          && snapshot.body.length <= 16_000 && cacheLimit > 0) {
          while (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
          cache.set(key, { snapshot, expiresAt: Date.now() + (snapshot.status === 404 ? 10_000 : 60_000) });
        }
        return snapshot;
      }).finally(() => { if (flights.get(key) === created) flights.delete(key); }) };
      flight = created;
      flights.set(key, flight);
    }
    const subscribed = flight;
    subscribed.subscribers += 1;
    return new Promise<Response>((resolve, reject) => {
      let done = false;
      const finish = (snapshot?: Snapshot, error?: unknown) => {
        if (done) return;
        done = true;
        signal?.removeEventListener('abort', onAbort);
        subscribed.subscribers -= 1;
        if (subscribed.subscribers === 0 && flights.get(key) === subscribed) {
          flights.delete(key);
          subscribed.controller.abort();
        }
        if (snapshot) resolve(restore(snapshot));
        else reject(error);
      };
      const onAbort = () => finish(undefined, aborted());
      signal?.addEventListener('abort', onAbort, { once: true });
      subscribed.promise.then((snapshot) => finish(snapshot), (error: unknown) => finish(undefined, error));
      if (signal?.aborted) onAbort();
    });
  };
}

function restore(snapshot: Snapshot): Response {
  return new Response(snapshot.body, { status: snapshot.status, headers: snapshot.headers });
}

// Share rate permits across server route bundles/HMR; never store account/session data here.
const registry = globalThis as typeof globalThis & { __lifeScryfallTransport?: ReturnType<typeof createScryfallTransport> };
export const fetchScryfall = registry.__lifeScryfallTransport ??= createScryfallTransport();
