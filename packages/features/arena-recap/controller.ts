import {arenaRecapPeriod, type ArenaRecapDays, type ArenaRecapPeriod} from '../../domain/arena-recap-period';
import type {ArenaRecapSummary} from '../../domain/arena-recap';
import type {ArenaRecapPayload} from './text';

type Scope = Readonly<{accountId: string; groupId: string}>;
type ExportKind = 'share' | 'copy' | 'download';
type ErrorKind = 'unavailable' | 'changed' | 'forbidden' | 'too_large' | ExportKind;
type Commands = {
  now: () => Date;
  read: (period: ArenaRecapPeriod, signal: AbortSignal) => Promise<ArenaRecapSummary>;
  makePayload: (summary: ArenaRecapSummary, period: ArenaRecapPeriod, includeNames: boolean) => ArenaRecapPayload;
  share?: (payload: ArenaRecapPayload) => Promise<'opened' | 'cancelled'>;
  copy?: (payload: ArenaRecapPayload) => Promise<void>;
  download?: (payload: ArenaRecapPayload) => Promise<void>;
};
type Job = {kind: 'read' | ExportKind; controller: AbortController; commands: Commands | null};
export type ArenaRecapSnapshot = Readonly<{
  open: boolean; days: ArenaRecapDays; includeNames: boolean;
  period: ArenaRecapPeriod | null; summary: ArenaRecapSummary | null;
  pending: Job['kind'] | null; error: ErrorKind | null; feedback: 'copied' | 'downloaded' | null;
}>;

/** One private opening; no automatic export and no publication-success claim. */
export function createArenaRecapController(scope: Scope) {
  const captured = {...scope};
  const initial: ArenaRecapSnapshot = {open: false, days: 7, includeNames: false, period: null, summary: null, pending: null, error: null, feedback: null};
  let snapshot = initial, active = false, commands: Commands | null = null, request: Job | null = null;
  const listeners = new Set<() => void>();
  function update(patch: Partial<ArenaRecapSnapshot>) {
    snapshot = {...snapshot, ...patch};
    if (active) Array.from(listeners).forEach(notify => notify());
  }
  function current(job: Job) {return active && snapshot.open && request === job && !job.controller.signal.aborted;}
  function publish(job: Job, patch: Partial<ArenaRecapSnapshot>) {
    if (!current(job)) return false;
    update(patch); return true;
  }
  function abort() {const previous = request; request = null; previous?.controller.abort();}
  function close() {abort(); update(initial);}
  function finish(job: Job) {if (request === job) {request = null; if (active) update({pending: null});}}
  async function load(days: ArenaRecapDays): Promise<boolean> {
    if (!active || !snapshot.open || (request && request.kind !== 'read')) return false;
    abort();
    const job: Job = {kind: 'read', controller: new AbortController(), commands};
    request = job;
    update({days, period: null, summary: null, pending: 'read', error: null, feedback: null});
    try {
      if (!job.commands) throw new Error('ARENA_RECAP_UNBOUND');
      const period = arenaRecapPeriod(days, job.commands.now());
      if (!publish(job, {period})) return false;
      const summary = await job.commands.read(period, job.controller.signal);
      return publish(job, {summary});
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      publish(job, {error: code === 'ARENA_HISTORY_CHANGED' ? 'changed' : code === 'ARENA_HISTORY_FORBIDDEN' ? 'forbidden'
        : code === 'ARENA_HISTORY_TOO_LARGE' ? 'too_large' : 'unavailable'});
      return false;
    } finally {finish(job);}
  }
  async function exportText(kind: ExportKind): Promise<boolean> {
    if (!active || !snapshot.open || request || !snapshot.summary || !snapshot.period) return false;
    const {summary, period, includeNames} = snapshot;
    const job: Job = {kind, controller: new AbortController(), commands}; request = job;
    update({pending: kind, error: null, feedback: null});
    try {
      if (!current(job)) return false;
      const action = job.commands?.[kind];
      if (!job.commands || !action) throw new Error('ARENA_RECAP_EXPORT_UNAVAILABLE');
      const payload = job.commands.makePayload(summary, period, includeNames);
      if (!current(job)) return false;
      // The platform API is invoked synchronously before the first await,
      // preserving the user's share/clipboard activation gesture.
      const outcome = await action(payload);
      if (!current(job) || outcome === 'cancelled') return false;
      return publish(job, {feedback: kind === 'copy' ? 'copied' : kind === 'download' ? 'downloaded' : null});
    } catch (error) {
      if (!(kind === 'share' && error instanceof Error && error.name === 'AbortError')) publish(job, {error: kind});
      return false;
    } finally {finish(job);}
  }
  return {
    view: {getSnapshot: () => snapshot, getInitialSnapshot: () => initial,
      subscribe: (notify: () => void) => {listeners.add(notify); return () => {listeners.delete(notify);};}},
    bind: (scope: Scope, input: Commands) => {
      if (scope.accountId !== captured.accountId || scope.groupId !== captured.groupId) throw new Error('ARENA_RECAP_SCOPE_CHANGED');
      commands = {...input};
    },
    activate: () => {active = Boolean(captured.accountId && captured.groupId);},
    deactivate: () => {active = false; commands = null; close();},
    open: () => {if (!active || snapshot.open) return Promise.resolve(false); update({...initial, open: true}); return load(7);},
    close, retry: () => load(snapshot.days),
    setDays: (days: ArenaRecapDays) => days === snapshot.days ? Promise.resolve(false) : load(days),
    setIncludeNames: (includeNames: boolean) => {if (active && snapshot.open && (!request || request.kind === 'read')) update({includeNames, feedback: null});},
    exportText,
  };
}
export type ArenaRecapController = ReturnType<typeof createArenaRecapController>;
