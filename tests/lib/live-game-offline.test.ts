import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveGamePlayer, type LiveGameRecord } from '@/lib/live-game';
import { clearWebLiveGameJournal, loadWebLiveGameJournal, saveWebLiveGameJournal, type WebLiveGameJournal } from '@/lib/live-game-offline';

function fixture(): WebLiveGameJournal {
  const record: LiveGameRecord = { id: 'game', group_id: 'group', created_by: 'alice', status: 'active', starting_life: 40,
    state: { version: 0, events: [], players: ['user:alice', 'user:bob'].map((participantKey, slot) => createLiveGamePlayer({
      slot, participantKey: participantKey as 'user:alice' | 'user:bob', deckId: `deck-${slot}`, displayName: participantKey,
      commander: 'Commander', commanderImage: null, startingLife: 40, allParticipantKeys: ['user:alice', 'user:bob'],
    })) }, match_id: null, started_at: '2026-11-16T00:00:00Z', ended_at: null,
    created_at: '2026-11-16T00:00:00Z', updated_at: '2026-11-16T00:00:00Z' };
  return { record, serverRecord: record, needsCreate: false, mutations: [{ id: 'op1', mutation: { type: 'adjust', targetKey: 'user:alice', amount: -1, mode: 'life' } }],
    pendingFinalization: null, pendingCancel: false, history: { undo: [], redo: [] }, savedAt: '2026-11-16T00:00:00Z' };
}
const key = 'phyrexian-arena:web-live-game:v2:alice:group';
const legacy = 'phyrexian-arena:web-live-game:v1:group';
describe('web account-scoped crash journal', () => {
  let values: Map<string,string>;
  let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    values = new Map();
    storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => values.set(key, value)), removeItem: vi.fn((key: string) => values.delete(key)) };
    vi.stubGlobal('window', { localStorage: storage });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('roundtrips operation IDs and isolates accounts and groups', () => {
    expect(saveWebLiveGameJournal('group', fixture(), 'alice').ok).toBe(true);
    expect(loadWebLiveGameJournal('group','alice').journal?.mutations).toEqual(fixture().mutations);
    expect(loadWebLiveGameJournal('group','bob').journal).toBeNull();
    expect(loadWebLiveGameJournal('other','alice').journal).toBeNull();
    expect(clearWebLiveGameJournal('group','bob','game').ok).toBe(true);
    expect(values.has(key)).toBe(true);
  });
  it('migrates legacy only for verified creator after a durable replacement', () => {
    values.set(legacy,JSON.stringify(fixture()));
    expect(loadWebLiveGameJournal('group','alice').journal?.record.id).toBe('game');
    expect(values.has(key)).toBe(true); expect(values.has(legacy)).toBe(false);
  });
  it('keeps ambiguous legacy data even when the current account is a participant', () => {
    values.set(legacy,JSON.stringify(fixture()));
    expect(loadWebLiveGameJournal('group','bob')).toEqual({ journal: null, error: 'ownership' });
    expect(values.has(legacy)).toBe(true); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('retains the original and playable memory state when legacy migration hits quota', () => {
    values.set(legacy,JSON.stringify(fixture())); storage.setItem.mockImplementation(() => { throw new Error('QuotaExceededError'); });
    const result = loadWebLiveGameJournal('group','alice');
    expect(result.error).toBe('unavailable'); expect(result.journal?.mutations[0].id).toBe('op1');
    expect(values.has(legacy)).toBe(true);
  });
  it.each(['{bad', JSON.stringify({ schemaVersion: 99 }), JSON.stringify({ schemaVersion: 2, accountId: 'bob', journal: fixture() })])('preserves unreadable/future/foreign journal %s', raw => {
    values.set(key,raw); expect(loadWebLiveGameJournal('group','alice').error).not.toBeNull();
    expect(saveWebLiveGameJournal('group',fixture(),'alice').ok).toBe(false);
    expect(clearWebLiveGameJournal('group','alice','game').ok).toBe(false);
    expect(values.get(key)).toBe(raw);
  });
  it.each(['mutations', 'needsCreate', 'pendingCancel', 'pendingFinalization'])('cannot replace an unacknowledged game with %s', pending => {
    const first = { ...fixture(), mutations: [], [pending]: pending === 'mutations' ? fixture().mutations : pending === 'pendingFinalization'
      ? { winnerKey: null, isDraw: true, winCondition: null, endedAt: '2026-11-16T01:00:00Z', players: [] } : true };
    values.set(key,JSON.stringify({ schemaVersion: 2, accountId: 'alice', journal: first }));
    const next = fixture(); next.record = { ...next.record, id: 'next' }; next.serverRecord = next.record;
    expect(saveWebLiveGameJournal('group',next,'alice')).toEqual({ ok: false, error: 'pending_game' });
    expect(loadWebLiveGameJournal('group','alice').journal?.record.id).toBe('game');
  });
  it('does not clear a newer game on a late old-game acknowledgement', () => {
    saveWebLiveGameJournal('group',fixture(),'alice');
    expect(clearWebLiveGameJournal('group','alice','old').ok).toBe(false);
    expect(values.has(key)).toBe(true);
    expect(clearWebLiveGameJournal('group','alice','game').ok).toBe(true);
  });
  it('rejects malformed operations, duplicate operation IDs and wrong group/server identity', () => {
    for (const journal of [ { ...fixture(), mutations: [{ id: 'x', mutation: { type: 'adjust', amount: 'oops' } }] },
      { ...fixture(), mutations: [...fixture().mutations,...fixture().mutations] },
      { ...fixture(), record: { ...fixture().record, group_id: 'wrong' } },
      { ...fixture(), serverRecord: { ...fixture().record, id: 'wrong' } } ]) {
      const raw = JSON.stringify({ schemaVersion: 2, accountId: 'alice', journal }); values.set(key,raw);
      expect(loadWebLiveGameJournal('group','alice')).toEqual({ journal: null, error: 'invalid' });
      expect(values.get(key)).toBe(raw);
    }
  });
  it('reports denied storage and silent writes without throwing or claiming persistence', () => {
    storage.setItem.mockImplementation(() => undefined);
    expect(saveWebLiveGameJournal('group',fixture(),'alice')).toEqual({ ok: false, error: 'unavailable' });
    storage.getItem.mockImplementation(() => { throw new Error('SecurityError'); });
    expect(loadWebLiveGameJournal('group','alice').error).toBe('unavailable');
    expect(clearWebLiveGameJournal('group','alice','game').ok).toBe(false);
  });
  it('rejects an account envelope whose user neither owns nor participates in the game', () => {
    const raw = JSON.stringify({ schemaVersion: 2, accountId: 'charlie', journal: fixture() });
    values.set('phyrexian-arena:web-live-game:v2:charlie:group',raw);
    expect(loadWebLiveGameJournal('group','charlie').error).toBe('ownership');
    expect(saveWebLiveGameJournal('group',fixture(),'charlie')).toEqual({ ok: false, error: 'ownership' });
    expect(saveWebLiveGameJournal('group',fixture(),'bob').ok).toBe(true);
  });
  it('preserves corrupted legacy data and detects a failed removal', () => {
    values.set(legacy,'{bad');
    expect(loadWebLiveGameJournal('group','alice').error).toBe('invalid');
    expect(values.get(legacy)).toBe('{bad');
    saveWebLiveGameJournal('group',fixture(),'alice');
    storage.removeItem.mockImplementation(() => undefined);
    expect(clearWebLiveGameJournal('group','alice','game').ok).toBe(false);
    expect(values.has(key)).toBe(true);
  });
  it('has explicit non-browser results', () => {
    vi.stubGlobal('window',undefined);
    expect(loadWebLiveGameJournal('group','alice')).toEqual({ journal: null, error: null });
    expect(saveWebLiveGameJournal('group',fixture(),'alice').ok).toBe(false);
    expect(clearWebLiveGameJournal('group','alice','game').ok).toBe(false);
  });
});
