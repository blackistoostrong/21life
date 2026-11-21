import { withRequestDeadline, type RpcTransport } from './request-deadline';
import type { ArenaMatchHeaderWrite, ArenaMatchParticipantWrite } from '../domain/arena-match-write';

export type ArenaMatchWriteCommand = {
  actorId: string; groupId: string; matchId: string; create: boolean;
  header: ArenaMatchHeaderWrite; participants: ArenaMatchParticipantWrite[];
};

/** One actor-bound transaction; never fall back to separate private writes. */
export async function saveArenaMatch(port: RpcTransport, command: ArenaMatchWriteCommand, signal?: AbortSignal) {
  if (!command.actorId || !command.groupId || !command.matchId) throw new Error('Missing arena match context');
  const { data, error } = await withRequestDeadline({ abortSignal: requestSignal => port.rpc('save_arena_match_v1', {
    p_actor_id: command.actorId, p_group_id: command.groupId, p_match_id: command.matchId,
    p_create: command.create, p_match: command.header, p_participants: command.participants,
  }).abortSignal(requestSignal) }, 15000, signal);
  if (error) throw error;
  if (signal?.aborted) { const error = new Error('Operation aborted'); error.name = 'AbortError'; throw error; }
  if (data !== command.matchId) throw new Error('Match was not saved. Reopen it and retry.');
  return command.matchId;
}
