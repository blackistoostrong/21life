import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { randomUUID } from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { saveArenaMatch } from '@/lib/arena-match-write';
import { buildArenaMatchWrite, type ArenaMatchWriteInput } from '../../packages/domain/arena-match-write';

function aborted() { const error = new Error('Operation aborted'); error.name = 'AbortError'; return error; }
/** Native commands are actor-bound and cannot survive a committed context change. */
export function useArenaMatchWrite(groupId: string | undefined, userId: string | undefined) {
  const epoch = useMemo(() => ({ groupId, userId }), [groupId, userId]);
  const owner = useRef<{ epoch: typeof epoch; jobs: Map<string, AbortController> } | null>(null);
  const request = useRef<{ epoch: typeof epoch; opening: unknown; fingerprint: string; id: string } | null>(null);
  useLayoutEffect(() => {
    const current = { epoch, jobs: new Map<string, AbortController>() };
    owner.current = current;
    return () => {
      current.jobs.forEach(controller => controller.abort());
      current.jobs.clear();
      if (owner.current === current) owner.current = null;
    };
  }, [epoch]);
  return useCallback(async (input: ArenaMatchWriteInput, matchId?: string, signal?: AbortSignal, opening?: unknown) => {
    const current = owner.current;
    if (!userId || !groupId || current?.epoch !== epoch) throw aborted();
    const slot = matchId ?? 'create';
    if (current.jobs.has(slot)) throw new Error('MATCH_SAVE_PENDING');
    const controller = new AbortController(); current.jobs.set(slot, controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const payload = buildArenaMatchWrite(input);
      const fingerprint = JSON.stringify(payload);
      if (!matchId && (request.current?.epoch !== epoch || request.current.opening !== opening || request.current.fingerprint !== fingerprint)) {
        request.current = { epoch, opening, fingerprint, id: randomUUID() };
      }
      await saveArenaMatch(supabase, { actorId: userId, groupId,
        matchId: matchId ?? request.current!.id, create: input.mode === 'create', ...payload }, controller.signal);
      if (controller.signal.aborted || owner.current !== current) throw aborted();
      if (!matchId) request.current = null;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (current.jobs.get(slot) === controller) current.jobs.delete(slot);
    }
  }, [epoch, groupId, userId]);
}
