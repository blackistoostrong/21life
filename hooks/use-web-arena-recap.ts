'use client';

import {useLayoutEffect, useMemo, useSyncExternalStore} from 'react';
import {useLanguage} from '@/components/language-provider';
import {createArenaRecapController} from '@/lib/arena-recap-controller';
import {arenaRecapLabels, createArenaRecapPayload} from '@/lib/arena-recap-text';
import {webArenaRecapExports} from '@/lib/arena-recap-export';
import {readArenaRecap} from '@/lib/arena-recap';
import {formatGameDuration} from '@/lib/live-game-duration';
import {createWebLiveCommandClient} from '@/lib/web-live-command-client';

export function useWebArenaRecap(accountId: string, groupId: string, groupName: string) {
  const {language} = useLanguage();
  const controller = useMemo(() => createArenaRecapController({accountId, groupId}), [accountId, groupId]);
  useLayoutEffect(() => {
    controller.bind({accountId, groupId}, {
      now: () => new Date(),
      read: async (period, signal) => {
        // Reuse the existing actor/JWT-bound SDK transport, without live commands.
        const {client} = await createWebLiveCommandClient(accountId, signal);
        return readArenaRecap(client, groupId, period, signal);
      },
      makePayload: (summary, period, includeNames) => createArenaRecapPayload(summary, period,
        {groupName, language, includeNames}, formatGameDuration),
      ...webArenaRecapExports,
    });
  }, [accountId, groupId, groupName, language, controller]);
  useLayoutEffect(() => {controller.activate(); return () => controller.deactivate();}, [controller]);
  const snapshot = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getInitialSnapshot);
  const payload = snapshot.summary && snapshot.period ? createArenaRecapPayload(snapshot.summary, snapshot.period,
    {groupName, language, includeNames: snapshot.includeNames}, formatGameDuration) : null;
  return {controller, snapshot, payload, labels: arenaRecapLabels(language), canShare: typeof navigator !== 'undefined' && typeof navigator.share === 'function'};
}
