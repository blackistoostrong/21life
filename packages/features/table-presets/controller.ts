import {
  copyTablePresetDraft, TablePresetError,
  type TablePresetDraft, type TablePresetErrorKind, type TablePresetScope, type TablePresetV1,
} from '../../domain/table-presets';
import type {createTablePresetRepository} from '../../data/table-preset-storage';
import type {PreparedTablePreset} from '../../data/table-preset-references';

type Repository = ReturnType<typeof createTablePresetRepository>;
type Operation = 'list' | 'save' | 'rename' | 'remove' | 'preview' | 'apply';
type Request = {kind: Operation; controller: AbortController; committed: boolean; commands: Commands | null};
export type TablePresetSnapshot = Readonly<{
  presets: readonly TablePresetV1[];
  loaded: boolean;
  pending: Operation | null;
  error: TablePresetErrorKind | null;
  preview: TablePresetV1 | null;
}>;
type Commands = {
  readDraft: () => TablePresetDraft;
  prepare: (preset: TablePresetV1, signal: AbortSignal) => Promise<PreparedTablePreset>;
  apply: (prepared: PreparedTablePreset) => void;
};

/** One opening owns commands and readonly snapshots. React and SDKs stay in adapters. */
export function createTablePresetController(scope: TablePresetScope, repository: Repository) {
  const capturedScope = {accountId: scope.accountId, groupId: scope.groupId};
  const initial: TablePresetSnapshot = {presets: [], loaded: false, pending: null, error: null, preview: null};
  let snapshot = initial;
  let active = false;
  let commands: Commands | null = null;
  let request: Request | null = null;
  const listeners = new Set<() => void>();

  function update(patch: Partial<TablePresetSnapshot>): void {
    snapshot = {...snapshot, ...patch};
    if (active) Array.from(listeners).forEach(notify => notify());
  }
  function current(job: Request): boolean {
    return active && request === job && !job.controller.signal.aborted;
  }
  function publish(job: Request, patch: Partial<TablePresetSnapshot>): boolean {
    if (!current(job)) return false;
    update(patch);
    return true;
  }
  function cancel(): void {
    const previous = request;
    request = null;
    previous?.controller.abort();
    update({pending: null, preview: null, error: null});
  }
  async function run(kind: Operation, work: (job: Request) => Promise<void>): Promise<boolean> {
    if (!active || request) return false;
    const job: Request = {kind, controller: new AbortController(), committed: false, commands};
    request = job;
    update({pending: kind, error: null, ...(kind === 'preview' ? {preview: null} : {})});
    try {
      await work(job);
      return job.committed || current(job);
    } catch (error) {
      if (current(job)) {
        update({
          error: error instanceof TablePresetError ? error.kind : kind === 'apply' ? 'references' : 'storage',
        });
      }
      return false;
    } finally {
      if (request === job) {
        request = null;
        if (active) update({pending: null});
      }
    }
  }

  function bound(job: Request): Commands {
    if (!job.commands) throw new TablePresetError('changed');
    return job.commands;
  }

  return {
    bind: (scope: TablePresetScope, input: Commands) => {
      if (scope.accountId !== capturedScope.accountId || scope.groupId !== capturedScope.groupId) {
        throw new TablePresetError('scope');
      }
      commands = {readDraft: input.readDraft, prepare: input.prepare, apply: input.apply};
    },
    view: {
      getSnapshot: () => snapshot,
      getInitialSnapshot: () => initial,
      subscribe: (notify: () => void) => {
        listeners.add(notify);
        return () => {listeners.delete(notify);};
      },
    },
    activate: () => {active = true;},
    deactivate: () => {active = false; commands = null; cancel();},
    cancel,
    refresh: () => run('list', async job => {
      const presets = await repository.list(capturedScope, job.controller.signal);
      publish(job, {presets, loaded: true});
    }),
    save: (name: string) => run('save', async job => {
      const draft = copyTablePresetDraft(bound(job).readDraft());
      const presets = await repository.save(capturedScope, name, draft, job.controller.signal);
      publish(job, {presets, loaded: true});
    }),
    rename: (id: string, name: string) => run('rename', async job => {
      const presets = await repository.rename(capturedScope, id, name, job.controller.signal);
      publish(job, {presets, loaded: true});
    }),
    remove: (id: string) => run('remove', async job => {
      const presets = await repository.remove(capturedScope, id, job.controller.signal);
      publish(job, {presets, loaded: true, preview: snapshot.preview?.id === id ? null : snapshot.preview});
    }),
    requestLoad: (id: string) => run('preview', async job => {
      const presets = await repository.list(capturedScope, job.controller.signal);
      if (!publish(job, {presets, loaded: true})) return;
      const preset = presets.find(preset => preset.id === id);
      if (!preset) throw new TablePresetError('not_found');
      publish(job, {preview: preset});
    }),
    confirmLoad: () => {
      const preview = snapshot.preview;
      if (!preview) return Promise.resolve(false);
      return run('apply', async job => {
        const presets = await repository.list(capturedScope, job.controller.signal);
        if (!publish(job, {presets, loaded: true})) return;
        const preset = presets.find(preset => preset.id === preview.id);
        if (!preset) {
          publish(job, {preview: null});
          throw new TablePresetError('not_found');
        }
        if (JSON.stringify(copyTablePresetDraft(preset)) !== JSON.stringify(copyTablePresetDraft(preview))) {
          publish(job, {preview: preset});
          throw new TablePresetError('changed');
        }
        const prepared = await bound(job).prepare(preset, job.controller.signal);
        if (!publish(job, {preview: null})) return;
        bound(job).apply(prepared);
        // Applying can close/unmount this owner. The accepted setup must still
        // count as applied; no asynchronous work or state publication follows.
        job.committed = true;
      });
    },
  };
}

export type TablePresetController = ReturnType<typeof createTablePresetController>;
