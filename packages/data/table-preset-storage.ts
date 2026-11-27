import {
  addTablePreset, copyTablePresetDraft, renameTablePreset, removeTablePreset, TablePresetError,
  type TablePresetDraft, type TablePresetScope, type TablePresetV1,
} from '../domain/table-presets';

export interface TablePresetStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  /** Browser adapter holds a cross-tab lock for the complete read/modify/write. */
  exclusive?<T>(key: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
export interface TablePresetCodec {
  validateScope(scope: TablePresetScope): void;
  decode(raw: string | null, scope: TablePresetScope): TablePresetV1[];
  encode(presets: readonly TablePresetV1[], scope: TablePresetScope): string;
}
export interface TablePresetIdentity {
  randomUUID(): string;
  now(): string;
}

export function tablePresetStorageKey(scope: TablePresetScope): string {
  return `phyrexian-arena:table-presets:v1:${scope.accountId}:${scope.groupId}`;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TablePresetError('cancelled');
}

/** No private-data cache. Accepted operations enter their key's queue immediately. */
export function createTablePresetRepository(storage: TablePresetStorage, codec: TablePresetCodec, identity: TablePresetIdentity) {
  const tails = new Map<string, Promise<unknown>>();

  function execute<T>(scope: TablePresetScope, signal: AbortSignal | undefined,
    work: (key: string, captured: TablePresetScope) => Promise<T>): Promise<T> {
    const captured = {accountId: scope.accountId, groupId: scope.groupId};
    codec.validateScope(captured);
    const key = tablePresetStorageKey(captured);
    const perform = async () => {
      try {
        checkCancelled(signal);
        const action = () => {
          checkCancelled(signal);
          return work(key, captured);
        };
        const result = storage.exclusive ? await storage.exclusive(key, action, signal) : await action();
        checkCancelled(signal);
        return result;
      } catch (error) {
        checkCancelled(signal);
        if (error instanceof TablePresetError) throw error;
        throw new TablePresetError('storage');
      }
    };
    const previous = tails.get(key) ?? Promise.resolve();
    const queued = previous.then(perform, perform);
    const tracked = queued.finally(() => {
      if (tails.get(key) === tracked) tails.delete(key);
    });
    tails.set(key, tracked);
    return tracked;
  }

  async function read(key: string, scope: TablePresetScope, signal?: AbortSignal): Promise<TablePresetV1[]> {
    const raw = await storage.getItem(key);
    checkCancelled(signal);
    return codec.decode(raw, scope);
  }

  async function write(key: string, scope: TablePresetScope, presets: TablePresetV1[], signal?: AbortSignal): Promise<TablePresetV1[]> {
    const raw = codec.encode(presets, scope);
    checkCancelled(signal);
    await storage.setItem(key, raw);
    checkCancelled(signal);
    return presets;
  }

  return {
    list(scope: TablePresetScope, signal?: AbortSignal): Promise<TablePresetV1[]> {
      return execute(scope, signal, (key, captured) => read(key, captured, signal));
    },
    save(scope: TablePresetScope, name: string, draft: TablePresetDraft, signal?: AbortSignal): Promise<TablePresetV1[]> {
      const capturedDraft = copyTablePresetDraft(draft);
      return execute(scope, signal, async (key, captured) => {
        const current = await read(key, captured, signal);
        const next = addTablePreset(current, captured, {
          id: identity.randomUUID(), name, updatedAt: identity.now(), draft: capturedDraft,
        });
        return write(key, captured, next, signal);
      });
    },
    rename(scope: TablePresetScope, id: string, name: string, signal?: AbortSignal): Promise<TablePresetV1[]> {
      return execute(scope, signal, async (key, captured) => {
        const current = await read(key, captured, signal);
        return write(key, captured, renameTablePreset(current, captured, id, name, identity.now()), signal);
      });
    },
    remove(scope: TablePresetScope, id: string, signal?: AbortSignal): Promise<TablePresetV1[]> {
      return execute(scope, signal, async (key, captured) => {
        const current = await read(key, captured, signal);
        return write(key, captured, removeTablePreset(current, captured, id), signal);
      });
    },
  };
}
