import { withRequestDeadline } from './request-deadline';

export interface ArenaMatchDeletePort {
  remove: (groupId: string, matchId: string, signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;
}

/** Delete only the authorized parent; PostgreSQL owns the participant cascade. */
export async function deleteArenaMatch(port: ArenaMatchDeletePort, groupId: string, matchId: string, signal?: AbortSignal) {
  if (!groupId || !matchId) throw new Error('Missing arena match context');
  const { data, error } = await withRequestDeadline({ abortSignal: requestSignal => port.remove(groupId, matchId, requestSignal) }, 15000, signal);
  if (error) throw error;
  signal?.throwIfAborted();
  if (!Array.isArray(data) || !data.some(row => typeof row === 'object' && row !== null && 'id' in row && row.id === matchId)) {
    throw new Error('Match was not deleted');
  }
}
