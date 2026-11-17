import { expect, it } from 'vitest';
import * as web from '../../lib/live-game';
import * as native from '../../expo/lib/live-game';
import * as runtime from '../../packages/data/live-game-runtime';
import publicNames from '../fixtures/live-game-public-api.json';

it('preserves every installed-client runtime export and one shared implementation', () => {
  expect(Object.keys(web).sort()).toEqual(publicNames);
  expect(Object.keys(native).sort()).toEqual(publicNames);
  expect(web.applyLiveGameMutation).toBe(runtime.applyLiveGameMutation);
  expect(native.applyLiveGameMutation).toBe(runtime.applyLiveGameMutation);
  expect(web.parseLiveGameState).toBe(native.parseLiveGameState);
  expect(web.createLiveGamePlayer).toBe(native.createLiveGamePlayer);
});
