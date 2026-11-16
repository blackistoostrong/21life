import { describe, expect, it } from 'vitest';
import { countLiveGamePendingOperations, getLiveGameSyncCopy, getLiveGameSyncIndicator, getLiveGameSyncState, isLiveGameAuthenticationError,
  type LiveGameSyncInput, type LiveGameSyncState } from '@/lib/live-game-sync-presentation';

const synced: LiveGameSyncInput = { pendingOperations: 0, online: true, syncing: false, localPersistenceAvailable: true, authenticationRequired: false, hasError: false };
describe('live sync evidence and presentation', () => {
  it.each([
    [{}, 'synced'], [{ pendingOperations: 2 }, 'pending'], [{ syncing: true }, 'syncing'],
    [{ online: false }, 'offline'], [{ online: false, pendingOperations: 1 }, 'offline_pending'],
    [{ authenticationRequired: true }, 'authentication_required'], [{ hasError: true }, 'error'],
    [{ localPersistenceAvailable: false }, 'storage_unavailable'],
  ] as Array<[Partial<LiveGameSyncInput>, LiveGameSyncState]>)('derives %j → %s', (input, expected) => {
    expect(getLiveGameSyncState({ ...synced, ...input })).toBe(expected);
    for (const language of ['it','en','unsupported']) expect(getLiveGameSyncCopy(expected,language).label.length).toBeGreaterThan(0);
    expect(['synced','pending','syncing','offline','error']).toContain(getLiveGameSyncIndicator(expected));
  });
  it('never reports synchronization from online status while auth, pending or storage evidence disagrees', () => {
    expect(getLiveGameSyncState({ ...synced, authenticationRequired: true, syncing: true })).toBe('authentication_required');
    expect(getLiveGameSyncState({ ...synced, localPersistenceAvailable: false, authenticationRequired: true })).toBe('storage_unavailable');
    expect(getLiveGameSyncState({ ...synced, online: false, hasError: true, pendingOperations: 2 })).toBe('offline_pending');
    expect(getLiveGameSyncCopy('authentication_required','en').hint).toContain('Sign in again');
    expect(getLiveGameSyncCopy('authentication_required','it').hint).toContain('Accedi di nuovo');
  });
  it('counts creation, terminal commands and archived operations even with no queued mutations', () => {
    expect(countLiveGamePendingOperations({ mutations: 0, needsCreate: true, finalization: true, cancellation: false })).toBe(2);
    expect(countLiveGamePendingOperations({ mutations: 2, needsCreate: false, finalization: false, cancellation: true, archivedOperations: 3 })).toBe(6);
  });
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])('refuses invalid count %s', value => {
    expect(() => getLiveGameSyncState({ ...synced, pendingOperations: value })).toThrow('Invalid operation count');
    expect(() => countLiveGamePendingOperations({ mutations: value, needsCreate: false, finalization: false, cancellation: false })).toThrow();
  });
  it('rejects count overflow', () => {
    expect(() => countLiveGamePendingOperations({ mutations: Number.MAX_SAFE_INTEGER, needsCreate: true, finalization: false, cancellation: false })).toThrow();
  });
  it.each([{ status: 401 }, { code: 'PGRST301' }, { code: 'PGRST302' }, { code: 'PGRST303' }, { code: 'bad_jwt' }, { code: 'session_not_found' },
    { code: 'refresh_token_not_found' }, { code: 'refresh_token_already_used' }])('recognizes authentication evidence %j', error => {
    expect(isLiveGameAuthenticationError(error)).toBe(true);
  });
  it.each([null, 'JWT expired', new Error('failed'), { status: 403 }, { code: '42501' }, { code: 401 }, {}])('does not mislabel ordinary failures %j', error => {
    expect(isLiveGameAuthenticationError(error)).toBe(false);
  });
});
