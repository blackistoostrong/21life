'use client';

import {useLayoutEffect,useMemo,useSyncExternalStore} from 'react';
import {createTablePresetController} from '@/lib/table-preset-controller';
import {tablePresets} from '@/lib/table-presets';
import {createWebLiveCommandClient} from '@/lib/web-live-command-client';
import {createLiveGameReferenceReader} from '@/lib/live-game-reference-reader';
import {prepareTablePresetReferences} from '../packages/data/table-preset-references';
import {TablePresetError,type TablePresetDraft} from '../packages/domain/table-presets';
import type {WebTrackerSetupController} from './use-web-tracker-setup';

export function useWebTablePresets(groupId: string, userId: string, setup: WebTrackerSetupController, online: boolean) {
  const controller = useMemo(() => createTablePresetController({accountId: userId, groupId}, tablePresets), [groupId, userId]);
  useLayoutEffect(() => {
    controller.bind({accountId: userId, groupId}, {
      readDraft: (): TablePresetDraft => {
        if (setup.setupReadyKey !== `${userId}:${groupId}`) throw new TablePresetError('references');
        return {
          playerCount: setup.playerCount, startingLife: setup.startingLife, layoutVariant: setup.layoutVariant,
          seats: setup.seats.map(seat => {
            const participant = setup.participants.find(participant => participant.key === seat.participantKey);
            const deck = participant?.decks.find(deck => deck.id === seat.deckId);
            if (seat.deckId && (!participant || !deck)) throw new TablePresetError('references');
            return {...seat, deckKind: !seat.participantKey || !seat.deckId ? null
              : seat.participantKey.startsWith('guest:') ? 'guest' : deck?.isOccasional ? 'occasional' : 'registered'};
          }),
        };
      },
      prepare: async (preset, signal) => {
        if (preset.accountId !== userId || preset.groupId !== groupId) throw new TablePresetError('scope');
        if (!online) throw new TablePresetError('references');
        const {client} = await createWebLiveCommandClient(userId, signal);
        return prepareTablePresetReferences(preset, createLiveGameReferenceReader(client), signal);
      },
      apply: setup.applyPreset,
    });
  }, [controller, groupId, userId, setup, online]);
  useLayoutEffect(() => {
    controller.activate();
    return () => controller.deactivate();
  }, [controller]);
  const snapshot = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getInitialSnapshot);
  return {controller, snapshot};
}
