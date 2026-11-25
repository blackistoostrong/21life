import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { createLiveGameCommandClient } from '../lib/live-game-command-client';

type Snapshot = Parameters<typeof createLiveGameCommandClient>[1];

/** Actor/group lifetime; renewing the same actor's token does not restart the game. */
export function useLiveGameCommandScope(actorId: string | undefined, groupId: string | undefined, session: Snapshot) {
  const epoch = useMemo(() => ({ actorId, groupId }), [actorId, groupId]);
  const owner = useRef<{ epoch: typeof epoch; session: Snapshot } | null>(null);
  const latestSession = useRef(session);
  useLayoutEffect(() => {
    latestSession.current = session;
    if (owner.current?.epoch === epoch) owner.current.session = session;
  }, [epoch, session]);
  useLayoutEffect(() => {
    const current = { epoch, session: latestSession.current };
    owner.current = current;
    return () => { if (owner.current === current) owner.current = null; };
  }, [epoch]);
  const isCurrent = useCallback(() => Boolean(actorId && groupId) && owner.current?.epoch === epoch,
    [actorId, groupId, epoch]);
  const bindClient = useCallback(() => {
    if (!isCurrent()) throw new Error('LIVE_GAME_COMMAND_SESSION_CHANGED');
    return createLiveGameCommandClient(actorId, owner.current!.session);
  }, [actorId, isCurrent]);
  return { epoch, isCurrent, bindClient };
}
