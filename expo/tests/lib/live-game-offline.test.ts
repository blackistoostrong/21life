import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveGamePlayer, type LiveGameRecord } from '@/lib/live-game';

const { storage, multiSet, getItem } = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    multiSet: vi.fn(async (entries: [string, string][]) => {
      entries.forEach(([key, value]) => storage.set(key, value));
    }),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem,
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

const sessionKey = 'phyrexian-arena:live-game:v3:user-1:group-1';
const backupSessionKey = sessionKey + ':backup';
const outboxKey = 'phyrexian-arena:live-game:v3:outbox:user-1';

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

  it('isolates pending archives between accounts on the same device', async () => {
    const item = { id: 'owned-op', serverRecord: record(), needsCreate: false, mutations: [], finalization: null, cancel: true };
    await saveLiveGameOutbox([item], 'user-1');
    expect(await loadLiveGameOutbox('user-2')).toEqual([]);
    expect(await loadLiveGameOutbox('user-1')).toEqual([item]);
  });

  it('does not let another account clear an existing group journal', async () => {
    await saveLiveGameOfflineSession('group-1', {
      record: record(), serverRecord: record(), needsCreate: false, mutations: [],
      pendingFinalization: null, pendingCancel: false, history: { undo: [], redo: [] },
    }, 'user-1');
    await clearLiveGameOfflineSession('group-1', 'user-2');
    expect((await loadLiveGameOfflineSession('group-1', 'user-1'))?.record.id).toBe('live-1');
    expect(await loadLiveGameOfflineSession('group-1', 'user-2')).toBeNull();
  });

  it('recovers a creator legacy journal without deleting it or resurrecting it after clear', async () => {
    const legacyKey = 'phyrexian-arena:live-game:v2:group-1';
    const raw = JSON.stringify({ record: record('legacy'), savedAt: '2026-07-15T10:00:00.000Z' });
    storage.set(legacyKey, raw);
    expect(await loadLiveGameOfflineSession('group-1', 'user-2')).toBeNull();
    expect((await loadLiveGameOfflineSession('group-1', 'user-1'))?.record.id).toBe('legacy');
    expect(storage.get(legacyKey)).toBe(raw);
    await clearLiveGameOfflineSession('group-1', 'user-1');
    expect(await loadLiveGameOfflineSession('group-1', 'user-1')).toBeNull();
    expect(storage.get(legacyKey)).toBe(raw);
  });

  it('recovers each creators legacy archive independently and keeps the original bytes', async () => {
    const first = { id: 'op-a', serverRecord: record(), needsCreate: false, mutations: [], finalization: null, cancel: true };
    const second = { ...first, id: 'op-b', serverRecord: { ...record(), created_by: 'user-2' } };
    const legacyKey = 'phyrexian-arena:live-game:v2:outbox';
    const raw = JSON.stringify([first, second]);
    storage.set(legacyKey, raw);
    expect(await Promise.all([loadLiveGameOutbox('user-1'), loadLiveGameOutbox('user-2')])).toEqual([[first], [second]]);
    await saveLiveGameOutbox([], 'user-1');
    expect(await loadLiveGameOutbox('user-1')).toEqual([]);
    expect(await loadLiveGameOutbox('user-2')).toEqual([second]);
    expect(storage.get(legacyKey)).toBe(raw);
  });

  it('preserves legacy bytes if copying the journal fails and permits a later retry', async () => {
    const legacyKey = 'phyrexian-arena:live-game:v2:group-1';
    const raw = JSON.stringify({ record: record('legacy') });
    storage.set(legacyKey, raw);
    multiSet.mockRejectedValueOnce(new Error('device write failed'));
    await expect(loadLiveGameOfflineSession('group-1', 'user-1')).rejects.toThrow('device write failed');
    expect(storage.get(legacyKey)).toBe(raw);
    expect((await loadLiveGameOfflineSession('group-1', 'user-1'))?.record.id).toBe('legacy');
  });

  it('rejects missing account identity without modifying device storage', async () => {
    await expect(loadLiveGameOutbox(null)).rejects.toThrow('LIVE_GAME_STORAGE_ACCOUNT_REQUIRED');
    await expect(clearLiveGameOfflineSession('group-1', '')).rejects.toThrow('LIVE_GAME_STORAGE_ACCOUNT_REQUIRED');
    expect(storage.size).toBe(0);
  });

  it('selects the newest creator legacy shadow and skips a broken primary', async () => {
    const primary = 'phyrexian-arena:live-game:v2:group-1';
    const shadow = 'phyrexian-arena:live-game:v2:backup:group-1';
    storage.set(primary, JSON.stringify({ record: record('older'), savedAt: '2026-07-15T10:00:00Z' }));
    storage.set(shadow, JSON.stringify({ record: record('newer'), savedAt: '2026-07-15T11:00:00Z' }));
    expect((await loadLiveGameOfflineSession('group-1', 'user-1'))?.record.id).toBe('newer');
    storage.clear();
    storage.set(primary, '{broken');
    storage.set(shadow, JSON.stringify({ record: record('recovered') }));
    expect((await loadLiveGameOfflineSession('group-1', 'user-1'))?.record.id).toBe('recovered');
  });

  it('does not expose foreign or future scoped envelopes or wrong-group legacy data', async () => {
    for (const envelope of [
      { record: record(), accountId: 'user-2', schemaVersion: 3 },
      { record: record(), accountId: 'user-1', schemaVersion: 4 },
      { record: { ...record(), group_id: 'other' }, accountId: 'user-1', schemaVersion: 3 },
      { record: { id: 'incomplete' }, accountId: 'user-1', schemaVersion: 3 },
    ]) {
      storage.set(sessionKey, JSON.stringify(envelope));
      expect(await loadLiveGameOfflineSession('group-1', 'user-1')).toBeNull();
    }
    storage.clear();
    storage.set('phyrexian-arena:live-game:v2:group-1', JSON.stringify({ record: { ...record(), group_id: 'other' } }));
    expect(await loadLiveGameOfflineSession('group-1', 'user-1')).toBeNull();
  });

  it('does not block another account while a device read is pending', async () => {
    let release!: (value: string | null) => void;
    getItem.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = loadLiveGameOutbox('user-1');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await loadLiveGameOutbox('user-2')).toEqual([]);
    release(null);
    expect(await pending).toEqual([]);
  });

  it('serializes simultaneous writes for the same account', async () => {
    await Promise.all([saveLiveGameOutbox([], 'user-1'), saveLiveGameOutbox([], 'user-1')]);
    expect(await loadLiveGameOutbox('user-1')).toEqual([]);
  });

  it('round-trips sessions and fills optional legacy fields safely', async () => {
    await saveLiveGameOfflineSession('group-1', {
      record: record(), serverRecord: record(), needsCreate: true, mutations: [],
      pendingFinalization: null, pendingCancel: false, history: { undo: [], redo: [] },
    }, 'user-1');
    const loaded = await loadLiveGameOfflineSession('group-1', 'user-1');
    expect(loaded).toMatchObject({ needsCreate: true, pendingCancel: false });
    expect(loaded?.record.state.layoutVariant).toBe('classic');
    expect(Date.parse(loaded?.savedAt ?? '')).not.toBeNaN();

    storage.delete(backupSessionKey);
    storage.set(sessionKey, JSON.stringify({ record: record(), accountId: 'user-1', schemaVersion: 3 }));
    expect(await loadLiveGameOfflineSession('group-1', 'user-1')).toMatchObject({
      needsCreate: false, mutations: [], pendingFinalization: null, pendingCancel: false,
      savedAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('rejects malformed, incomplete, and corrupted session data', async () => {
    storage.set(sessionKey, '{bad json');
    expect(await loadLiveGameOfflineSession('group-1', 'user-1')).toBeNull();
    storage.set(sessionKey, JSON.stringify({ record: { id: 'x', state: {} } }));
    expect(await loadLiveGameOfflineSession('group-1', 'user-1')).toBeNull();
    storage.delete(sessionKey);
    expect(await loadLiveGameOfflineSession('group-1', 'user-1')).toBeNull();
  });

  it('recovers the live game from the shadow journal after a partial write', async () => {
    await saveLiveGameOfflineSession('group-1', {
      record: record(), serverRecord: record(), needsCreate: false, mutations: [],
      pendingFinalization: null, pendingCancel: false, history: { undo: [], redo: [] },
    }, 'user-1');
    storage.set(sessionKey, '{partial');
    expect(storage.has(backupSessionKey)).toBe(true);
    expect((await loadLiveGameOfflineSession('group-1', 'user-1'))?.record.id).toBe('live-1');
  });

  it('uses the newest journal copy after an interrupted primary update', async () => {
    const session = (game: LiveGameRecord, savedAt: string) => JSON.stringify({
      accountId: 'user-1', schemaVersion: 3,
      record: game, serverRecord: game, needsCreate: false, mutations: [],
      pendingFinalization: null, pendingCancel: false, history: { undo: [], redo: [] }, savedAt,
    });
    storage.set(sessionKey, session(record('stale'), '2026-07-15T10:00:00.000Z'));
    storage.set(backupSessionKey, session(record('fresh'), '2026-07-15T10:01:00.000Z'));
    expect((await loadLiveGameOfflineSession('group-1', 'user-1'))?.record.id).toBe('fresh');
  });

  it('round-trips outbox entries and reports corrupted storage without discarding it', async () => {
    const item = { id: 'op-1', serverRecord: record(), needsCreate: false, mutations: [], finalization: null, cancel: true };
    await saveLiveGameOutbox([item], 'user-1');
    expect(await loadLiveGameOutbox('user-1')).toEqual([item]);
    storage.set(outboxKey, '{broken');
    await expect(loadLiveGameOutbox('user-1')).rejects.toThrow('LIVE_GAME_OUTBOX_UNAVAILABLE');
    storage.set(outboxKey, JSON.stringify({ not: 'an array' }));
    await expect(loadLiveGameOutbox('user-1')).rejects.toThrow('LIVE_GAME_OUTBOX_UNAVAILABLE');
  });

  it('does not overwrite a corrupt outbox or clear the session when archival fails', async () => {
    storage.set(outboxKey, '{broken');
    storage.set(sessionKey, 'original-session');
    storage.set(backupSessionKey, 'original-backup');
    const item = { id: 'op-1', serverRecord: record(), needsCreate: false, mutations: [], finalization: null, cancel: true };
    const writesBefore = multiSet.mock.calls.length;
    await expect(archiveAndClearLiveGameSession('group-1', item, 'user-1')).rejects.toThrow('LIVE_GAME_OUTBOX_UNAVAILABLE');
    expect(storage.get(outboxKey)).toBe('{broken');
    expect(storage.get(sessionKey)).toBe('original-session');
    expect(storage.get(backupSessionKey)).toBe('original-backup');
    expect(multiSet.mock.calls.length).toBe(writesBefore);
  });

  it('deduplicates archived operations and clears the active session atomically', async () => {
    const old = { id: 'op-1', serverRecord: record('old'), needsCreate: false, mutations: [], finalization: null, cancel: false };
    const replacement = { ...old, serverRecord: record('new'), cancel: true };
    await saveLiveGameOutbox([old], 'user-1');
    storage.set(sessionKey, JSON.stringify({ record: record() }));
    await archiveAndClearLiveGameSession('group-1', replacement, 'user-1');
    expect(await loadLiveGameOutbox('user-1')).toEqual([replacement]);
    expect(storage.get(sessionKey)).toBe('null');
    await clearLiveGameOfflineSession('group-1', 'user-1');
    expect(storage.get(sessionKey)).toBe('null');
  });

  it('clears a stale late journal without deleting a newer rematch', async () => {
    const session = (game: LiveGameRecord) => ({
      record: game, serverRecord: game, needsCreate: false, mutations: [],
      pendingFinalization: null, pendingCancel: false, history: { undo: [], redo: [] },
    });

    await saveLiveGameOfflineSession('group-1', session(record('old')), 'user-1');
    await clearLiveGameOfflineSessionIfMatches('group-1', 'old', 'user-1');
    expect(await loadLiveGameOfflineSession('group-1', 'user-1')).toBeNull();

    await saveLiveGameOfflineSession('group-1', session(record('new')), 'user-1');
    await clearLiveGameOfflineSessionIfMatches('group-1', 'old', 'user-1');
    expect((await loadLiveGameOfflineSession('group-1', 'user-1'))?.record.id).toBe('new');
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
    await saveLiveGameOfflineSession('group-1', old, 'user-1');
    const before = new Map(storage);
    multiSet.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(prepareLiveGameReplacement('group-1', old, record('new'), Promise.resolve(), 'user-1'))
      .rejects.toThrow('storage unavailable');
    expect(storage).toEqual(before);
    expect(old.mutations).toHaveLength(1);
    expect(old.pendingCancel).toBe(true);
    expect(await loadLiveGameOutbox('user-1')).toEqual([]);
  });

  it('keeps cancellation and mutations on A while B gets a clean journal', async () => {
    const old = previous();
    const next = await prepareLiveGameReplacement('group-1', old, record('new'), Promise.resolve(), 'user-1');
    await saveLiveGameOfflineSession('group-1', next, 'user-1');
    expect(await loadLiveGameOutbox('user-1')).toEqual([{
      id: 'old', serverRecord: old.serverRecord, needsCreate: false,
      mutations: old.mutations, cancel: true, finalization: null,
    }]);
    expect(await loadLiveGameOfflineSession('group-1', 'user-1')).toMatchObject({
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
    const next = await prepareLiveGameReplacement('group-1', old, record('new'), Promise.resolve(), 'user-1');
    expect((await loadLiveGameOutbox('user-1'))[0]).toMatchObject({
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
    const lateWrite = gate.then(() => saveLiveGameOfflineSession('group-1', old, 'user-1'));
    let prepared = false;
    const replacement = prepareLiveGameReplacement('group-1', old, record('new'), lateWrite, 'user-1')
      .then(next => { prepared = true; return next; });
    await Promise.resolve();
    expect(prepared).toBe(false);
    expect(await loadLiveGameOutbox('user-1')).toEqual([]);
    release();
    await saveLiveGameOfflineSession('group-1', await replacement, 'user-1');
    expect((await loadLiveGameOfflineSession('group-1', 'user-1'))?.record.id).toBe('new');
    expect((await loadLiveGameOutbox('user-1'))[0].id).toBe('old');
  });

  it('still archives after an earlier journal write rejected', async () => {
    const next = await prepareLiveGameReplacement('group-1', previous(), record('new'), Promise.reject(new Error('old write failed')), 'user-1');
    expect(next.record.id).toBe('new');
    expect((await loadLiveGameOutbox('user-1'))[0].id).toBe('old');
  });

  it('keeps A recoverable if saving the new journal fails after archiving', async () => {
    const old = previous();
    const next = await prepareLiveGameReplacement('group-1', old, record('new'), Promise.resolve(), 'user-1');
    multiSet.mockRejectedValueOnce(new Error('new journal failed'));
    await expect(saveLiveGameOfflineSession('group-1', next, 'user-1')).rejects.toThrow('new journal failed');
    expect((await loadLiveGameOutbox('user-1'))[0]).toMatchObject({
      id: 'old', serverRecord: { id: 'old' }, mutations: old.mutations, cancel: true,
    });
  });

  it('does not queue a clean old game for replay', async () => {
    const old = previous();
    old.mutations = [];
    old.pendingCancel = false;
    const next = await prepareLiveGameReplacement('group-1', old, record('new'), Promise.resolve(), 'user-1');
    expect(await loadLiveGameOutbox('user-1')).toEqual([]);
    expect(next.record.id).toBe('new');
    expect(next.history.undo).toEqual([]);
  });
});
