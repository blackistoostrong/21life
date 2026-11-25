import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parseLiveGameState,
  type LiveGameRecord,
  type QueuedLiveGameMutation,
  type WinCondition,
} from '@/lib/live-game';
import { createLiveGameHistory, parseLiveGameHistory, type LiveGameHistory } from '@/lib/live-game-history';

const STORAGE_PREFIX = 'phyrexian-arena:live-game:v2:';
const STORAGE_BACKUP_PREFIX = 'phyrexian-arena:live-game:v2:backup:';
const OUTBOX_KEY = 'phyrexian-arena:live-game:v2:outbox';

export type PendingLiveGameFinalization = {
  winnerKey: string | null;
  isDraw: boolean;
  winCondition: WinCondition | null;
  endedAt: string;
  players: Array<{
    participantKey: string;
    deckId: string;
    isGuest: boolean;
    userId: string | null;
    guestId: string | null;
  }>;
};

export type LiveGameOfflineSession = {
  record: LiveGameRecord;
  serverRecord: LiveGameRecord;
  needsCreate: boolean;
  mutations: QueuedLiveGameMutation[];
  pendingFinalization: PendingLiveGameFinalization | null;
  pendingCancel: boolean;
  history: LiveGameHistory;
  savedAt: string;
};

export type ArchivedLiveGameOperation = {
  id: string;
  serverRecord: LiveGameRecord;
  needsCreate: boolean;
  mutations: QueuedLiveGameMutation[];
  finalization: PendingLiveGameFinalization | null;
  cancel: boolean;
};

function storageKey(groupId: string) {
  return `${STORAGE_PREFIX}${groupId}`;
}

function backupStorageKey(groupId: string) {
  return `${STORAGE_BACKUP_PREFIX}${groupId}`;
}

function parseOfflineSession(raw: string | null): LiveGameOfflineSession | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<LiveGameOfflineSession>;
  if (!parsed.record?.id || !parsed.record?.state?.players) return null;
  const record = { ...parsed.record, state: parseLiveGameState(parsed.record.state) } as LiveGameRecord;
  const rawServerRecord = parsed.serverRecord ?? parsed.record;
  const serverRecord = {
    ...rawServerRecord,
    state: parseLiveGameState(rawServerRecord.state),
  } as LiveGameRecord;
  return {
    record,
    serverRecord,
    needsCreate: Boolean(parsed.needsCreate),
    mutations: Array.isArray(parsed.mutations) ? parsed.mutations : [],
    pendingFinalization: parsed.pendingFinalization ?? null,
    pendingCancel: Boolean(parsed.pendingCancel),
    history: parseLiveGameHistory(parsed.history),
    savedAt: parsed.savedAt ?? new Date(0).toISOString(),
  };
}


type Account = string | null | undefined;
const storageWork = new Map<string, Promise<void>>();
function serialize<T>(accountId: Account, work: () => Promise<T>): Promise<T> {
  if (!accountId?.trim()) return Promise.reject(new Error('LIVE_GAME_STORAGE_ACCOUNT_REQUIRED'));
  const previous = storageWork.get(accountId) ?? Promise.resolve();
  const result = previous.then(work, work);
  const settled = result.then(() => undefined, () => undefined);
  storageWork.set(accountId, settled);
  void settled.then(() => { if (storageWork.get(accountId) === settled) storageWork.delete(accountId); });
  return result;
}
function actor(accountId: Account): string {
  // Public operations validate identity before entering the account queue.
  return encodeURIComponent(String(accountId));
}
function keys(groupId: string, accountId: Account) {
  const main = 'phyrexian-arena:live-game:v3:' + actor(accountId) + ':' + encodeURIComponent(groupId);
  return { main, backup: main + ':backup', migrated: main + ':legacy-migrated' };
}
function outboxKey(accountId: Account) { return 'phyrexian-arena:live-game:v3:outbox:' + actor(accountId); }
function parseOutbox(raw: string): ArchivedLiveGameOperation[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Invalid outbox');
    return parsed;
  } catch { throw new Error('LIVE_GAME_OUTBOX_UNAVAILABLE'); }
}
async function readSession(groupId: string, accountId: Account): Promise<LiveGameOfflineSession | null> {
  const owned = keys(groupId, accountId);
  const sessions: LiveGameOfflineSession[] = [];
  for (const key of [owned.main, owned.backup]) {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      const envelope = JSON.parse(raw);
      if (envelope?.accountId !== accountId || envelope?.schemaVersion !== 3) continue;
      const parsed = parseOfflineSession(raw);
      if (parsed?.record.group_id === groupId) sessions.push(parsed);
    } catch { /* The shadow copy may still contain the last acknowledged write. */ }
  }
  if (sessions.length) return sessions.sort((a,b) => (Date.parse(b.savedAt)||0)-(Date.parse(a.savedAt)||0))[0];
  if (await AsyncStorage.getItem(owned.migrated)) return null;
  const legacy: LiveGameOfflineSession[] = [];
  for (const key of [storageKey(groupId), backupStorageKey(groupId)]) {
    try {
      const parsed = parseOfflineSession(await AsyncStorage.getItem(key));
      if (parsed?.record.group_id === groupId && parsed.record.created_by === accountId) legacy.push(parsed);
    } catch { /* Preserve unknown legacy bytes; never assign them to another account. */ }
  }
  const recovered = legacy.sort((a,b) => (Date.parse(b.savedAt)||0)-(Date.parse(a.savedAt)||0))[0];
  if (!recovered) return null;
  const raw = JSON.stringify({ ...recovered, accountId, schemaVersion: 3 });
  await AsyncStorage.multiSet([[owned.backup,raw],[owned.main,raw],[owned.migrated,'1']]);
  return recovered;
}
async function readOutbox(accountId: Account): Promise<ArchivedLiveGameOperation[]> {
  const key = outboxKey(accountId);
  const current = await AsyncStorage.getItem(key);
  if (current !== null) return parseOutbox(current);
  const legacyRaw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (legacyRaw === null) return [];
  const legacy = parseOutbox(legacyRaw);
  const recovered = legacy.filter(item => item?.serverRecord?.created_by === accountId);
  // Keep the legacy archive intact. A durable empty scoped list also prevents
  // already processed legacy entries from resurrecting on the next opening.
  await AsyncStorage.setItem(key, JSON.stringify(recovered));
  return recovered;
}
export function loadLiveGameOfflineSession(groupId: string, accountId: Account): Promise<LiveGameOfflineSession | null> {
  return serialize(accountId, () => readSession(groupId,accountId));
}
export function saveLiveGameOfflineSession(groupId: string, session: Omit<LiveGameOfflineSession,'savedAt'>, accountId: Account): Promise<void> {
  return serialize(accountId, async () => {
    const owned=keys(groupId,accountId);
    const raw=JSON.stringify({...session,savedAt:new Date().toISOString(),accountId,schemaVersion:3});
    await AsyncStorage.multiSet([[owned.backup,raw],[owned.main,raw],[owned.migrated,'1']]);
  });
}
async function clearSession(groupId: string, accountId: Account): Promise<void> {
  const owned=keys(groupId,accountId);
  await AsyncStorage.multiSet([[owned.main,'null'],[owned.backup,'null'],[owned.migrated,'1']]);
}
export function clearLiveGameOfflineSession(groupId: string, accountId: Account): Promise<void> {
  return serialize(accountId, () => clearSession(groupId,accountId));
}
export function clearLiveGameOfflineSessionIfMatches(groupId: string, liveGameId: string, accountId: Account): Promise<void> {
  return serialize(accountId, async()=>{
    const current=await readSession(groupId,accountId);
    if(current?.record.id===liveGameId)await clearSession(groupId,accountId);
  });
}
export function loadLiveGameOutbox(accountId: Account): Promise<ArchivedLiveGameOperation[]> {
  return serialize(accountId, () => readOutbox(accountId));
}
export function saveLiveGameOutbox(items: ArchivedLiveGameOperation[], accountId: Account): Promise<void> {
  return serialize(accountId, () => AsyncStorage.setItem(outboxKey(accountId),JSON.stringify(items)));
}
export function archiveAndClearLiveGameSession(groupId: string,item: ArchivedLiveGameOperation,accountId: Account): Promise<void> {
  return serialize(accountId, async()=>{
    const owned=keys(groupId,accountId);
    const current=await readOutbox(accountId);
    const next=[...current.filter(entry=>entry.id!==item.id),item];
    await AsyncStorage.multiSet([[outboxKey(accountId),JSON.stringify(next)],
      [owned.main,'null'],[owned.backup,'null'],[owned.migrated,'1']]);
  });
}

export async function prepareLiveGameReplacement(
  groupId: string,
  previous: LiveGameOfflineSession,
  remote: LiveGameRecord,
  pendingJournalWrite: Promise<void>,
  accountId: string | null | undefined,
): Promise<Omit<LiveGameOfflineSession, 'savedAt'>> {
  await pendingJournalWrite.catch(() => undefined);
  if (previous.mutations.length || previous.pendingFinalization || previous.pendingCancel) {
    await archiveAndClearLiveGameSession(groupId, {
      id: previous.record.id,
      serverRecord: previous.serverRecord,
      needsCreate: previous.needsCreate,
      mutations: previous.mutations,
      finalization: previous.pendingFinalization,
      cancel: previous.pendingCancel,
    }, accountId);
  }
  return {
    record: remote,
    serverRecord: remote,
    needsCreate: false,
    mutations: [],
    pendingFinalization: null,
    pendingCancel: false,
    history: createLiveGameHistory(),
  };
}
