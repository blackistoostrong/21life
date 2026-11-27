import {useLayoutEffect, useMemo, useSyncExternalStore} from 'react';
import {useLanguage} from '@/contexts/language-context';
import {createArenaRecapController} from '@/lib/arena-recap-controller';
import {arenaRecapLabels, createArenaRecapPayload} from '@/lib/arena-recap-text';
import {nativeArenaRecapExports} from '@/lib/arena-recap-export';
import {readArenaRecap} from '@/lib/arena-recap';
import {formatGameDuration} from '@/lib/live-game-duration';
import {createLiveGameCommandClient} from '@/lib/live-game-command-client';

export function useNativeArenaRecap(accountId: string, groupId: string, groupName: string,
  session: Parameters<typeof createLiveGameCommandClient>[1]) {
  const {language} = useLanguage();
  const controller = useMemo(() => createArenaRecapController({accountId, groupId}), [accountId, groupId]);
  useLayoutEffect(() => {
    controller.bind({accountId, groupId}, {
      now: () => new Date(),
      read: (period, signal) => {
        const {client} = createLiveGameCommandClient(accountId, session);
        return readArenaRecap(client, groupId, period, signal);
      },
      makePayload: (summary, period, includeNames) => createArenaRecapPayload(summary, period,
        {groupName, language, includeNames}, formatGameDuration),
      ...nativeArenaRecapExports,
    });
  }, [accountId, groupId, groupName, language, session, controller]);
  useLayoutEffect(() => {controller.activate(); return () => controller.deactivate();}, [controller]);
  const snapshot = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getInitialSnapshot);
  const payload = snapshot.summary && snapshot.period ? createArenaRecapPayload(snapshot.summary, snapshot.period,
    {groupName, language, includeNames: snapshot.includeNames}, formatGameDuration) : null;
  return {controller, snapshot, payload, labels: arenaRecapLabels(language)};
}
