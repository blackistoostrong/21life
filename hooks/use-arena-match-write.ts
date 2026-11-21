'use client';
import { useRef } from 'react';
import { useCommandScope, type CommandJob } from '@/hooks/use-command-scope';
import { supabase } from '@/lib/supabase';
import { saveArenaMatch } from '@/lib/arena-match-write';
import { buildArenaMatchWrite, type ArenaMatchWriteInput } from '@/packages/domain/arena-match-write';

/** One opening owns its request ID, immutable payload and cancellable transaction. */
export function useArenaMatchWrite(userId: string | null, groupId: string, accessKey: string, opening: unknown) {
  const key = userId && groupId ? JSON.stringify([userId, groupId, accessKey]) : null;
  const scope = useCommandScope<'save'>(key, true, opening);
  const request = useRef<{ epoch: CommandJob['epoch']; fingerprint: string; id: string } | null>(null);
  const save = async (job: CommandJob, input: ArenaMatchWriteInput, matchId?: string) => {
    job.signal.throwIfAborted();
    if (!userId || !job.active() || job.epoch !== scope.epoch) throw new DOMException('Operation aborted', 'AbortError');
    const payload = buildArenaMatchWrite(input);
    const fingerprint = JSON.stringify(payload);
    if (!request.current || request.current.epoch !== job.epoch || request.current.fingerprint !== fingerprint) {
      request.current = { epoch: job.epoch, fingerprint, id: matchId ?? crypto.randomUUID() };
    }
    return saveArenaMatch(supabase, { actorId: userId, groupId, matchId: request.current.id,
      create: input.mode === 'create', ...payload }, job.signal);
  };
  return { ...scope, save };
}
