import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveGamePlayer, type LiveGameRecord } from '@/lib/live-game';

const { storage, multiSet } = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    multiSet: vi.fn(async (entries: [string, string][]) => {
      entries.forEach(([key, value]) => storage.set(key, value));
    }),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
    multiSet,
  },
}));

import {
  archiveAndClearLiveGameSession,
  clearLiveGameOfflineSession,
  clearLiveGameOfflineSessionIfMatches,
  loadLiveGameOfflineSession,
  loadLiveGameOutbox,
  prepareLiveGameReplacement,
  saveLiveGameOfflineSession,
  saveLiveGameOutbox,
  type LiveGameOfflineSession,
} from '@/lib/live-game-offline';

const sessionKey = 'phyrexian-arena:live-game:v2:group-1';
const backupSessionKey = 'phyrexian-arena:live-game:v2:backup:group-1';
const outboxKey = 'phyrexian-arena:live-game:v2:outbox';

function record(id = 'live-1'): LiveGameRecord {
  return {
    id, group_id: 'group-1', created_by: 'user-1', status: 'active', starting_life: 40,
    state: {
      version: 0, events: [], players: [createLiveGamePlayer({
        slot: 0, participantKey: 'user:user-1', deckId: 'deck-1', displayName: 'Marco',
        commander: 'Atraxa', commanderImage: null, startingLife: 40,
        allParticipantKeys: ['user:user-1'],
      })],
    },
    match_id: null, started_at: '2026-07-15T10:00:00.000Z', ended_at: null,
    created_at: '2026-07-15T10:00:00.000Z', updated_at: '2026-07-15T10:00:00.000Z',
  };
}

describe('live game offline persistence', () => {
  beforeEach(() => storage.clear());

  it('round-trips sessions and fills optional legacy fields safely', async () => {
    await saveLiveGameOfflineSession('group-1', {
      record: record(), serverRecord: record(), needsCreate: true, mutations: [],
      pendingFinalization: null, pendingCancel: false, history: { undo: [], redo: [] },
    });
    const loaded = await loadLiveGameOfflineSession('group-1');
    expect(loaded).toMatchObject({ needsCreate: true, pendingCancel: false });
    expect(loaded?.record.state.layoutVariant).toBe('classic');
    expect(Date.parse(loaded?.savedAt ?? '')).not.toBeNaN();

    storage.delete(backupSessionKey);
    storage.set(sessionKey, JSON.stringify({ record: record() }));
    expect(await loadLiveGameOfflineSession('group-1')).toMatchObject({
      needsCreate: false, mutations: [], pendingFinalization: null, pendingCancel: false,
      savedAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('rejects malformed, incomplete, and corrupted session data', async () => {
    storage.set(sessionKey, '{bad json');
    expect(await loadLiveGameOfflineSession('group-1')).toBeNull();
    storage.set(sessionKey, JSON.stringify({ record: { id: 'x', state: {} } }));
    expect(await loadLiveGameOfflineSession('group-1')).toBeNull();
    storage.delete(sessionKey);
    expect(await loadLiveGameOfflineSession('group-1')).toBeNull();
  });

  it('recovers the live game from the shadow journal after a partial write', async () => {
    await saveLiveGameOfflineSession('group-1', {
      record: record(), serverRecord: record(), needsCreate: false, mutations: [],
      pendingFinalization: null, pendingCancel: false, history: { undo: [], redo: [] },
    });
    storage.set(sessionKey, '{partial');
    expect(storage.has(backupSessionKey)).toBe(true);
    expect((await loadLiveGameOfflineSession('group-1'))?.record.id).toBe('live-1');
  });

  it('uses the newest journal copy after an interrupted primary update', async () => {
    const session = (game: LiveGameRecord, savedAt: string) => JSON.stringify({
      record: game, serverRecord: game, needsCreate: false, mutations: [],
      pendingFinalization: null, pendingCancel: false, history: { undo: [], redo: [] }, savedAt,
    });
    storage.set(sessionKey, session(record('stale'), '2026-07-15T10:00:00.000Z'));
    storage.set(backupSessionKey, session(record('fresh'), '2026-07-15T10:01:00.000Z'));
    expect((await loadLiveGameOfflineSession('group-1'))?.record.id).toBe('fresh');
  });

  it('round-trips outbox entries and reports corrupted storage without discarding it', async () => {
    const item = { id: 'op-1', serverRecord: record(), needsCreate: false, mutations: [], finalization: null, cancel: true };
    await saveLiveGameOutbox([item]);
    expect(await loadLiveGameOutbox()).toEqual([item]);
    storage.set(outboxKey, '{broken');
    await expect(loadLiveGameOutbox()).rejects.toThrow('LIVE_GAME_OUTBOX_UNAVAILABLE');
    storage.set(outboxKey, JSON.stringify({ not: 'an array' }));
    await expect(loadLiveGameOutbox()).rejects.toThrow('LIVE_GAME_OUTBOX_UNAVAILABLE');
  });

  it('does not overwrite a corrupt outbox or clear the session when archival fails', async () => {
    storage.set(outboxKey, '{broken');
    storage.set(sessionKey, 'original-session');
    storage.set(backupSessionKey, 'original-backup');
    const item = { id: 'op-1', serverRecord: record(), needsCreate: false, mutations: [], finalization: null, cancel: true };
    const writesBefore = multiSet.mock.calls.length;
    await expect(archiveAndClearLiveGameSession('group-1', item)).rejects.toThrow('LIVE_GAME_OUTBOX_UNAVAILABLE');
    expect(storage.get(outboxKey)).toBe('{broken');
    expect(storage.get(sessionKey)).toBe('original-session');
    expect(storage.get(backupSessionKey)).toBe('original-backup');
    expect(multiSet.mock.calls.length).toBe(writesBefore);
  });

  it('deduplicates archived operations and clears the active session atomically', async () => {
    const old = { id: 'op-1', serverRecord: record('old'), needsCreate: false, mutations: [], finalization: null, cancel: false };
    const replacement = { ...old, serverRecord: record('new'), cancel: true };
    await saveLiveGameOutbox([old]);
    storage.set(sessionKey, JSON.stringify({ record: record() }));
    await archiveAndClearLiveGameSession('group-1', replacement);
    expect(await loadLiveGameOutbox()).toEqual([replacement]);
    expect(storage.get(sessionKey)).toBe('null');
    await clearLiveGameOfflineSession('group-1');
    expect(storage.has(sessionKey)).toBe(false);
  });

  it('clears a stale late journal without deleting a newer rematch', async () => {
    const session = (game: LiveGameRecord) => ({
      record: game, serverRecord: game, needsCreate: false, mutations: [],
      pendingFinalization: null, pendingCancel: false, history: { undo: [], redo: [] },
    });

    await saveLiveGameOfflineSession('group-1', session(record('old')));
    await clearLiveGameOfflineSessionIfMatches('group-1', 'old');
    expect(await loadLiveGameOfflineSession('group-1')).toBeNull();

    await saveLiveGameOfflineSession('group-1', session(record('new')));
    await clearLiveGameOfflineSessionIfMatches('group-1', 'old');
    expect((await loadLiveGameOfflineSession('group-1'))?.record.id).toBe('new');
  });
});

describe('replacement of an offline live game', () => {
  beforeEach(() => storage.clear());

  function previous(): LiveGameOfflineSession {
    return {
      record: record('old'), serverRecord: record('old'), needsCreate: false,
      mutations: [{ id: 'move-1', mutation: { type: 'eliminate', targetKey: 'user:user-1', eliminatedAt: '2026-11-16T09:00:00Z' } }],
      pendingCancel: true, pendingFinalization: null,
      history: { undo: [{ forward: { type: 'last_standing', winnerKey: 'user:user-1' }, inverse: { type: 'last_standing', winnerKey: 'user:user-1' } }], redo: [] },
      savedAt: '2026-11-16T09:00:00Z',
    };
  }

  it('preserves the original journal and queue when archiving fails', async () => {
    const old = previous();
    await saveLiveGameOfflineSession('group-1', old);
    const before = new Map(storage);
    multiSet.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(prepareLiveGameReplacement('group-1', old, record('new'), Promise.resolve()))
      .rejects.toThrow('storage unavailable');
    expect(storage).toEqual(before);
    expect(old.mutations).toHaveLength(1);
    expect(old.pendingCancel).toBe(true);
    expect(await loadLiveGameOutbox()).toEqual([]);
  });

  it('keeps cancellation and mutations on A while B gets a clean journal', async () => {
    const old = previous();
    const next = await prepareLiveGameReplacement('group-1', old, record('new'), Promise.resolve());
    await saveLiveGameOfflineSession('group-1', next);
    expect(await loadLiveGameOutbox()).toEqual([{
      id: 'old', serverRecord: old.serverRecord, needsCreate: false,
      mutations: old.mutations, cancel: true, finalization: null,
    }]);
    expect(await loadLiveGameOfflineSession('group-1')).toMatchObject({
      record: { id: 'new' }, serverRecord: { id: 'new' }, needsCreate: false,
      mutations: [], pendingCancel: false, pendingFinalization: null,
      history: { undo: [], redo: [] },
    });
  });

  it('archives pending finalization exclusively against the old game ID', async () => {
    const old = previous();
    old.pendingCancel = false;
    old.mutations = [];
    old.pendingFinalization = {
      winnerKey: 'user:user-1', isDraw: false, winCondition: 'last_standing',
      endedAt: '2026-11-16T09:00:00Z', players: [],
    };
    const next = await prepareLiveGameReplacement('group-1', old, record('new'), Promise.resolve());
    expect((await loadLiveGameOutbox())[0]).toMatchObject({
      id: 'old', serverRecord: { id: 'old' }, finalization: old.pendingFinalization,
    });
    expect(next.pendingFinalization).toBeNull();
    expect(next.pendingCancel).toBe(false);
    expect(next.history).toEqual({ undo: [], redo: [] });
  });

  it('waits for a delayed journal write before archiving and installing B', async () => {
    const old = previous();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lateWrite = gate.then(() => saveLiveGameOfflineSession('group-1', old));
    let prepared = false;
    const replacement = prepareLiveGameReplacement('group-1', old, record('new'), lateWrite)
      .then(next => { prepared = true; return next; });
    await Promise.resolve();
    expect(prepared).toBe(false);
    expect(await loadLiveGameOutbox()).toEqual([]);
    release();
    await saveLiveGameOfflineSession('group-1', await replacement);
    expect((await loadLiveGameOfflineSession('group-1'))?.record.id).toBe('new');
    expect((await loadLiveGameOutbox())[0].id).toBe('old');
  });

  it('still archives after an earlier journal write rejected', async () => {
    const next = await prepareLiveGameReplacement('group-1', previous(), record('new'), Promise.reject(new Error('old write failed')));
    expect(next.record.id).toBe('new');
    expect((await loadLiveGameOutbox())[0].id).toBe('old');
  });

  it('keeps A recoverable if saving the new journal fails after archiving', async () => {
    const old = previous();
    const next = await prepareLiveGameReplacement('group-1', old, record('new'), Promise.resolve());
    multiSet.mockRejectedValueOnce(new Error('new journal failed'));
    await expect(saveLiveGameOfflineSession('group-1', next)).rejects.toThrow('new journal failed');
    expect((await loadLiveGameOutbox())[0]).toMatchObject({
      id: 'old', serverRecord: { id: 'old' }, mutations: old.mutations, cancel: true,
    });
  });

  it('does not queue a clean old game for replay', async () => {
    const old = previous();
    old.mutations = [];
    old.pendingCancel = false;
    const next = await prepareLiveGameReplacement('group-1', old, record('new'), Promise.resolve());
    expect(await loadLiveGameOutbox()).toEqual([]);
    expect(next.record.id).toBe('new');
    expect(next.history.undo).toEqual([]);
  });
});
