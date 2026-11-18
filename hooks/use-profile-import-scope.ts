'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

type Context = { readonly key: string | null };
type Epoch = { readonly context: Context; readonly enabled: boolean };
type JobName = 'import' | 'arts';
type Entry = { controller: AbortController; pending: boolean };
type Owner = { epoch: Epoch; jobs: Map<JobName, Entry> };
export type ProfileImportJob = {
  readonly epoch: Epoch;
  readonly signal: AbortSignal;
  active: () => boolean;
  finish: () => void;
};

/** Private import jobs belong to one committed account/role and modal phase. */
export function useProfileImportScope(key: string | null, enabled: boolean) {
  const context = useMemo<Context>(() => ({ key }), [key]);
  const epoch = useMemo<Epoch>(() => ({ context, enabled }), [context, enabled]);
  const ownerRef = useRef<Owner | null>(null);
  useLayoutEffect(() => {
    const owner: Owner = { epoch, jobs: new Map() };
    ownerRef.current = owner;
    return () => {
      owner.jobs.forEach(entry => entry.controller.abort());
      owner.jobs.clear();
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [epoch]);

  const committed = useCallback(() => Boolean(context.key) && ownerRef.current?.epoch === epoch, [context, epoch]);
  const cancel = useCallback((name?: JobName) => {
    const owner = ownerRef.current;
    if (owner?.epoch !== epoch) return;
    if (name) {
      owner.jobs.get(name)?.controller.abort();
      owner.jobs.delete(name);
    } else {
      owner.jobs.forEach(entry => entry.controller.abort());
      owner.jobs.clear();
    }
  }, [epoch]);
  const begin = useCallback((name: JobName, replace = false): ProfileImportJob | null => {
    const owner = ownerRef.current;
    if (!context.key || !epoch.enabled || owner?.epoch !== epoch) return null;
    const previous = owner.jobs.get(name);
    if (previous?.pending && !replace) return null;
    previous?.controller.abort();
    const entry: Entry = { controller: new AbortController(), pending: true };
    owner.jobs.set(name, entry);
    return {
      epoch,
      signal: entry.controller.signal,
      active: () => ownerRef.current === owner && owner.jobs.get(name) === entry && !entry.controller.signal.aborted,
      // Keep the bounded generation marker so queued acknowledged updates remain
      // valid until replacement/cancellation, even after React batches this reply.
      finish: () => { if (owner.jobs.get(name) === entry) entry.pending = false; },
    };
  }, [context, epoch]);
  return { context, epoch, committed, cancel, begin };
}
