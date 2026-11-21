export type LiveGameSyncState = 'synced' | 'pending' | 'syncing' | 'offline' | 'offline_pending' | 'authentication_required' | 'error' | 'storage_unavailable';
export type LiveGameSyncIndicator = 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

export interface LiveGameSyncInput {
  pendingOperations: number;
  online: boolean;
  syncing: boolean;
  localPersistenceAvailable: boolean;
  authenticationRequired: boolean;
  hasError: boolean;
}

export function countLiveGamePendingOperations(input: {
  mutations: number;
  needsCreate: boolean;
  finalization: boolean;
  cancellation: boolean;
  archivedOperations?: number;
}) {
  const archived = input.archivedOperations ?? 0;
  if (![input.mutations, archived].every(value => Number.isSafeInteger(value) && value >= 0)) throw new RangeError('Invalid operation count');
  const count = input.mutations + Number(input.needsCreate) + Number(input.finalization) + Number(input.cancellation) + archived;
  if (!Number.isSafeInteger(count)) throw new RangeError('Invalid operation count');
  return count;
}

export function isLiveGameAuthenticationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('status' in error && error.status === 401) return true;
  if ('code' in error && typeof error.code === 'string') {
    return ['PGRST301', 'PGRST302', 'PGRST303', 'bad_jwt', 'session_not_found', 'refresh_token_not_found', 'refresh_token_already_used'].includes(error.code);
  }
  return false;
}

/** Connection is evidence of reachability, never evidence of server acknowledgement. */
export function getLiveGameSyncState(input: LiveGameSyncInput): LiveGameSyncState {
  if (!Number.isSafeInteger(input.pendingOperations) || input.pendingOperations < 0) throw new RangeError('Invalid operation count');
  if (!input.localPersistenceAvailable) return 'storage_unavailable';
  if (input.authenticationRequired) return 'authentication_required';
  if (!input.online) return input.pendingOperations ? 'offline_pending' : 'offline';
  if (input.syncing) return 'syncing';
  if (input.hasError) return 'error';
  return input.pendingOperations ? 'pending' : 'synced';
}

export function getLiveGameSyncIndicator(state: LiveGameSyncState): LiveGameSyncIndicator {
  if (state === 'storage_unavailable' || state === 'authentication_required') return 'error';
  if (state === 'offline_pending') return 'offline';
  return state;
}

// Shared status copy contains no rendering or platform behaviour. Counts are
// separate so screen readers can announce state transitions without every tap.
export function getLiveGameSyncCopy(state: LiveGameSyncState, language: string) {
  const italian = language === 'it';
  const labels: Record<LiveGameSyncState, { it: string; en: string }> = {
    synced: { it: 'Sincronizzato', en: 'Synced' },
    pending: { it: 'Operazioni in attesa', en: 'Operations pending' },
    syncing: { it: 'Sincronizzazione', en: 'Syncing' },
    offline: { it: 'Offline', en: 'Offline' },
    offline_pending: { it: 'Offline · modifiche in attesa', en: 'Offline · changes pending' },
    authentication_required: { it: 'Accesso richiesto · Riprova', en: 'Sign-in required · Retry' },
    error: { it: 'Riprova sync', en: 'Retry sync' },
    storage_unavailable: { it: 'Salvataggio locale non disponibile', en: 'Local saving unavailable' },
  };
  const authHint = italian ? 'Accedi di nuovo per sincronizzare. Le operazioni in attesa sono conservate.'
    : 'Sign in again to synchronize. Pending operations are preserved.';
  return { label: italian ? labels[state].it : labels[state].en, hint: state === 'authentication_required' ? authHint : undefined };
}
