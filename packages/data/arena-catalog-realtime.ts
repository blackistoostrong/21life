export interface CatalogChannel {
  subscribe(onStatus: (status: string) => void): unknown;
  remove(): PromiseLike<unknown>;
  teardown(): void;
}
export interface ArenaCatalogPort {
  authenticate(): PromiseLike<unknown>;
  channel(topic: string, receive: (payload: unknown) => void): CatalogChannel;
}

export type ArenaCatalogEntity = 'deck' | 'member' | 'guest' | 'guest_deck';
export type ArenaCatalogEvent = { entity: ArenaCatalogEntity; operation: 'INSERT' | 'UPDATE' | 'DELETE'; id: string };
export type CatalogOptions = { scopeKey?: string; onReady?: () => void; onError?: () => void };
type Listener = { changed: (events: readonly ArenaCatalogEvent[]) => void; options: CatalogOptions };
type Entry = {
  scope: string; closed: boolean; ready: boolean; listeners: Set<Listener>; channel?: CatalogChannel;
  pending: Map<ArenaCatalogEntity, ArenaCatalogEvent>; timer: ReturnType<typeof setTimeout> | null;
  started: Promise<void>; stopped?: Promise<void>;
};
const clients = new WeakMap<object, Map<string, Entry>>();

function parseEvent(value: unknown): ArenaCatalogEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id.trim() || typeof row.entity !== 'string' || typeof row.operation !== 'string'
    || !['deck', 'member', 'guest', 'guest_deck'].includes(row.entity)
    || !['INSERT', 'UPDATE', 'DELETE'].includes(row.operation)) return null;
  return { id: row.id, entity: row.entity as ArenaCatalogEntity, operation: row.operation as ArenaCatalogEvent['operation'] };
}

/** One SDK channel per client/topic/actor; concurrent screens share a lease.
 * Account changes wait for the previous removal before creating a fresh channel.
 * SDK owns authentication generation and reconnect backoff, not this adapter. */
export function subscribeArenaCatalogBatch(client: object, port: ArenaCatalogPort, groupId: string,
  changed: Listener['changed'], options: CatalogOptions = {}): () => void {
  let topics = clients.get(client);
  if (!topics) { topics = new Map(); clients.set(client, topics); }
  const registry = topics;
  const topic = `arena:${groupId}:catalog`, scope = options.scopeKey ?? '';
  const stop = (entry: Entry): Promise<void> => {
    if (entry.stopped) return entry.stopped;
    entry.closed = true; entry.listeners.clear(); entry.pending.clear();
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    entry.stopped = entry.started.then(async () => {
      if (!entry.channel) return;
      let removed = false;
      try { removed = await entry.channel.remove() === 'ok'; }
      finally { if (!removed) entry.channel.teardown(); }
    }).catch(() => { /* Disposed listeners stay detached even if removal fails. */ }).finally(() => {
      if (registry.get(topic) === entry) registry.delete(topic);
    });
    return entry.stopped;
  };
  let entry = registry.get(topic);
  if (!entry || entry.closed || entry.scope !== scope) {
    const previous = entry ? stop(entry) : Promise.resolve();
    const fresh: Entry = { scope, closed: false, ready: false, listeners: new Set(), pending: new Map(), timer: null, started: Promise.resolve() };
    entry = fresh; registry.set(topic, fresh);
    fresh.started = previous.then(() => {
      if (fresh.closed) return;
      const channel = port.channel(topic, payload => {
        if (fresh.closed) return;
        const event = parseEvent(payload); if (!event) return;
        fresh.pending.set(event.entity, event);
        // A fixed window bounds invalidation latency even under a continuous burst.
        if (fresh.timer !== null) return;
        fresh.timer = setTimeout(() => {
          fresh.timer = null;
          const events = Array.from(fresh.pending.values()); fresh.pending.clear();
          if (!fresh.closed) fresh.listeners.forEach(listener => listener.changed(events));
        }, 120);
      });
      fresh.channel = channel;
      void Promise.resolve(port.authenticate()).then(() => {
        if (fresh.closed) return;
        channel.subscribe(status => {
          if (fresh.closed) return;
          fresh.ready = status === 'SUBSCRIBED';
          fresh.listeners.forEach(listener => {
            if (status === 'SUBSCRIBED') listener.options.onReady?.();
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') listener.options.onError?.();
          });
        });
      }).catch(() => { if (!fresh.closed) fresh.listeners.forEach(listener => listener.options.onError?.()); });
    }).catch(() => { if (!fresh.closed) fresh.listeners.forEach(listener => listener.options.onError?.()); });
  }
  const owned = entry;
  const listener: Listener = { changed, options }; owned.listeners.add(listener);
  if (owned.ready) void Promise.resolve().then(() => {
    if (!owned.closed && owned.listeners.has(listener)) listener.options.onReady?.();
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true; owned.listeners.delete(listener);
    if (!owned.listeners.size) void stop(owned);
  };
}

