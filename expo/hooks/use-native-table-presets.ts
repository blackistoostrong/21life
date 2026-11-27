import {useLayoutEffect,useMemo,useSyncExternalStore} from 'react';
import {createTablePresetController} from '@/lib/table-preset-controller';
import {tablePresets} from '@/lib/table-presets';
import {createLiveGameReferenceReader} from '@/lib/live-game-reference-reader';
import {prepareTablePresetReferences} from '../../packages/data/table-preset-references';
import {TablePresetError,type TablePresetDraft} from '../../packages/domain/table-presets';
import type {useNativeLiveSetup} from './use-native-live-setup';
import type {useLiveGameCommandScope} from './use-live-game-command-scope';

type Scope = Pick<ReturnType<typeof useLiveGameCommandScope>, 'epoch' | 'isCurrent' | 'bindClient'>;
export function useNativeTablePresets(groupId: string, userId: string, setup: ReturnType<typeof useNativeLiveSetup>,
  scope: Scope, online: boolean) {
  const controller = useMemo(() => createTablePresetController({accountId: userId, groupId}, tablePresets), [groupId, userId]);
  useLayoutEffect(() => {
    controller.bind({accountId: userId, groupId}, {
      readDraft: (): TablePresetDraft => {
        if (setup.setupReadyKey !== `${userId}:${groupId}`) throw new TablePresetError('references');
        return {
          playerCount: setup.playerCount, startingLife: setup.startingLife, layoutVariant: setup.layoutVariant,
          seats: setup.seatSetups.map(seat => {
            const deck = seat.participantKey ? setup.getDeckOptions(seat.participantKey).find(deck => deck.id === seat.deckId) : null;
            if (seat.deckId && !deck) throw new TablePresetError('references');
            return {...seat, deckKind: !seat.participantKey || !seat.deckId ? null
              : seat.participantKey.startsWith('guest:') ? 'guest' : deck?.source_type === 'occasional' ? 'occasional' : 'registered'};
          }),
        };
      },
      prepare: async (preset, signal) => {
        if (preset.accountId !== userId || preset.groupId !== groupId || scope.epoch.actorId !== userId
          || scope.epoch.groupId !== groupId || !scope.isCurrent()) throw new TablePresetError('scope');
        if (!online) throw new TablePresetError('references');
        const {client} = scope.bindClient();
        return prepareTablePresetReferences(preset, createLiveGameReferenceReader(client), signal);
      },
      apply: setup.applyPreset,
    });
  }, [controller, groupId, userId, setup, scope, online]);
  useLayoutEffect(() => {
    controller.activate();
    return () => controller.deactivate();
  }, [controller]);
  const snapshot = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getInitialSnapshot);
  return {controller, snapshot};
}
