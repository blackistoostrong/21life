import React, {StrictMode, useLayoutEffect, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {WebTablePresets} from '../../components/live-game/web-table-presets';
import {useWebTrackerSetup} from '../../hooks/use-web-tracker-setup';
import type {WebTrackerParticipant} from '../../lib/types/web-tracker';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const participants: WebTrackerParticipant[] = [
  {key: `user:${id(1)}`, displayName: 'Alice cached', isGuest: false, userId: id(1), guestId: null,
    decks: [{id: id(3), name: 'Cached A', commander: 'A', commanderImage: null, isFavorite: false}]},
  {key: `guest:${id(4)}`, displayName: 'Bob cached', isGuest: true, userId: null, guestId: id(4),
    decks: [{id: id(5), name: 'Cached B', commander: 'B', commanderImage: null, isFavorite: false}]},
];
let root: Root | null = null;
let configure: () => void;
let clear: () => void;
let omitCatalog: () => void;
function Owner({actor, group, online}: {actor: string; group: string; online: boolean}) {
  const [catalog, setCatalog] = useState(participants);
  const setup = useWebTrackerSetup(group, actor, catalog);
  useLayoutEffect(() => {
    configure = () => setup.restoreSetup({playerCount: 2, startingLife: 30, layoutVariant: 'classic',
      seats: [{participantKey: `user:${id(1)}`, deckId: id(3)}, {participantKey: `guest:${id(4)}`, deckId: id(5)}]});
    clear = () => setup.restoreSetup({playerCount: 4, startingLife: 20, layoutVariant: 'opposed',
      seats: Array.from({length: 4}, () => ({participantKey: null, deckId: null}))});
    omitCatalog = () => setCatalog([]);
  }, [setup]);
  return <>
    <WebTablePresets groupId={group} userId={actor} setup={setup} online={online} disabled={false} />
    <output data-testid="preset-setup">{JSON.stringify({actor, group, count: setup.playerCount, life: setup.startingLife,
      seats: setup.seats, step: setup.setupStep, missing: setup.presetMissingReferences,
      participants: setup.participants})}</output>
  </>;
}
Object.assign(window, {tablePresetUiHarness: {
  render: (actor = id(1), group = id(2), language = 'en', online = true) => {
    Object.assign(window, {presetActor: actor, presetLanguage: language});
    root ??= createRoot(document.getElementById('root')!);
    flushSync(() => root!.render(<StrictMode><Owner actor={actor} group={group} online={online} /></StrictMode>));
  },
  configure: () => flushSync(() => configure()), clear: () => flushSync(() => clear()),
  omitCatalog: () => flushSync(() => omitCatalog()),
  unmount: () => flushSync(() => {root?.unmount(); root = null;}),
}});
