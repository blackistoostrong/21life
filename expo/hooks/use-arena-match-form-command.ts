import { useLayoutEffect, useMemo, useRef, useState } from 'react';

/** A form opening owns both persistence cancellation and its eventual feedback. */
export function useArenaMatchFormCommand(contextKey: string, opening: unknown) {
  const epoch = useMemo(() => ({ contextKey, opening }), [contextKey, opening]);
  const owner = useRef<{ epoch: typeof epoch; controller: AbortController | null } | null>(null);
  const [pending, setPending] = useState<typeof epoch | null>(null);
  useLayoutEffect(() => {
    const current = { epoch, controller: null as AbortController | null }; owner.current = current;
    return () => { current.controller?.abort(); if (owner.current === current) owner.current = null; };
  }, [epoch]);
  const run = async (save: (signal: AbortSignal) => Promise<unknown>, success: () => void, failure: (error: unknown) => void) => {
    const current = owner.current;
    if (current?.epoch !== epoch || current.controller) return;
    const controller = new AbortController(); current.controller = controller; setPending(epoch);
    const active = () => owner.current === current && !controller.signal.aborted;
    try {
      await save(controller.signal);
      if (active()) success();
    } catch (error) {
      if (active()) failure(error);
    } finally {
      if (active()) setPending(previous => active() && previous === epoch ? null : previous);
      if (current.controller === controller) current.controller = null;
    }
  };
  return { run, saving: pending === epoch, opening: epoch };
}
