import React, {StrictMode, useLayoutEffect, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useNativeLiveSetup} from '../../hooks/use-native-live-setup';
import {useNativeTablePresets} from '../../hooks/use-native-table-presets';
import {useLiveGameCommandScope} from '../../hooks/use-live-game-command-scope';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Catalog = Parameters<typeof useNativeLiveSetup>[2];
const catalog: Catalog = {
  members: [{id: id(1), username: 'alice', display_name: 'Alice cached'}],
  decks: [{id: id(3), user_id: id(1), group_id: null, name: 'Cached A', commander: 'A', commander_image: null,
    source_url: null, source_type: 'manual', bracket: null, color_identity: null, is_favorite: false, created_at: '2026-11-27T00:00:00Z'}],
  guests: [{id: id(4), group_id: id(2), display_name: 'Bob cached', last_played_at: null, arena_guest_decks: [
    {id: id(5), guest_id: id(4), group_id: id(2), name: 'Cached B', commander: 'B', commander_image: null, bracket: null, color_identity: null},
  ]}], matches: [], loading: false,
};
let root: Root | null = null;
let manager: ReturnType<typeof useNativeTablePresets>['controller'];
let configure: () => void;
let clear: () => void;
let omitCatalog: () => void;
function Owner({actor, group, online, token}: {actor: string; group: string; online: boolean; token: string}) {
  const [currentCatalog, setCatalog] = useState(catalog);
  const scope = useLiveGameCommandScope(actor, group, {user: {id: actor}, access_token: token});
  const setup = useNativeLiveSetup(group, {id: actor}, currentCatalog, scope);
  const {controller, snapshot} = useNativeTablePresets(group, actor, setup, scope, online);
  useLayoutEffect(() => {
    manager = controller;
    configure = () => {setup.setPlayerCount(2); setup.applyStartingLife(30); setup.applySeatSetups([
      {participantKey: `user:${id(1)}`, deckId: id(3)}, {participantKey: `guest:${id(4)}`, deckId: id(5)},
    ]);};
    clear = () => {setup.setPlayerCount(4); setup.applyStartingLife(20); setup.applySeatSetups(
      Array.from({length: 4}, () => ({participantKey: null, deckId: null})));};
    omitCatalog = () => setCatalog({members: [], guests: [], decks: [], matches: [], loading: false});
  }, [setup, controller]);
  return <output data-testid="native-preset-state">{JSON.stringify({snapshot, ready: setup.setupReadyKey,
    count: setup.playerCount, life: setup.startingLife, seats: setup.seatSetups,
    revision: setup.presetReviewRevision, missing: setup.presetMissingReferences, participants: setup.setupParticipants})}</output>;
}
Object.assign(window, {nativePresetHarness: {
  render: (actor = id(1), group = id(2), online = true, token = 'fixture-token') => {
    root ??= createRoot(document.getElementById('root')!);
    flushSync(() => root!.render(<StrictMode><Owner actor={actor} group={group} online={online} token={token} /></StrictMode>));
  },
  configure: () => flushSync(() => configure()), clear: () => flushSync(() => clear()), omitCatalog: () => flushSync(() => omitCatalog()),
  refresh: () => manager.refresh(), save: (name: string) => manager.save(name),
  preview: (id: string) => manager.requestLoad(id), apply: () => manager.confirmLoad(),
  rename: (id: string, name: string) => manager.rename(id, name), remove: (id: string) => manager.remove(id),
  cancel: () => manager.cancel(), unmount: () => flushSync(() => {root?.unmount(); root = null;}),
}});
