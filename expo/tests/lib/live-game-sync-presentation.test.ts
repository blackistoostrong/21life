import { describe, expect, it } from 'vitest';
import { countLiveGamePendingOperations, getLiveGameSyncState, getLiveGameSyncCopy, isLiveGameAuthenticationError } from '@/lib/live-game-sync-presentation';

describe('native shared sync contract', () => {
  it('keeps creation and finalization pending before server acknowledgement', () => {
    const pendingOperations = countLiveGamePendingOperations({ mutations: 0, needsCreate: true, finalization: true, cancellation: false });
    const input = { pendingOperations, online: true, syncing: false, localPersistenceAvailable: true, authenticationRequired: false, hasError: false };
    expect(getLiveGameSyncState(input)).toBe('pending');
    expect(getLiveGameSyncState({ ...input, online: false })).toBe('offline_pending');
    expect(getLiveGameSyncState({ ...input, authenticationRequired: true })).toBe('authentication_required');
    expect(getLiveGameSyncState({ ...input, localPersistenceAvailable: false })).toBe('storage_unavailable');
  });
  it('uses the same authentication codes and instructions on both platforms', () => {
    expect(isLiveGameAuthenticationError({ code: 'PGRST301' })).toBe(true);
    expect(isLiveGameAuthenticationError({ code: '42501' })).toBe(false);
    expect(getLiveGameSyncCopy('authentication_required','it').hint).toContain('Accedi di nuovo');
    expect(getLiveGameSyncCopy('synced','en').label).toBe('Synced');
  });
});
