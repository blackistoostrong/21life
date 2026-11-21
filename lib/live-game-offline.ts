import type { WebLiveGameJournal } from '@/lib/live-game-journal-types';
import { parseWebLiveGameJournal, webJournalHasPendingOperations } from '@/lib/live-game-journal-contract';
export type { PendingLiveGameFinalization, WebLiveGameJournal } from '@/lib/live-game-journal-types';

export type WebJournalError = 'unavailable' | 'invalid' | 'ownership' | 'future' | 'pending_game';
type WriteResult = { ok: true } | { ok: false; error: WebJournalError };
type ReadResult = { journal: WebLiveGameJournal | null; error: WebJournalError | null };
const PREFIX = 'phyrexian-arena:web-live-game:v2:';
const LEGACY_PREFIX = 'phyrexian-arena:web-live-game:v1:';
const storageKey = (groupId: string, userId: string) => `${PREFIX}${userId}:${groupId}`;

function parseEnvelope(raw: string, groupId: string, userId: string): ReadResult {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('schemaVersion' in value)) return { journal: null, error: 'invalid' };
    if (value.schemaVersion !== 2) return { journal: null, error: 'future' };
    if (!('accountId' in value) || value.accountId !== userId) return { journal: null, error: 'ownership' };
    if (!('journal' in value)) return { journal: null, error: 'invalid' };
    const journal = parseWebLiveGameJournal(value.journal, groupId);
    if (journal.record.created_by !== userId && !journal.record.state.players.some(player => player.participantKey === `user:${userId}`)) {
      return { journal: null, error: 'ownership' };
    }
    return { journal, error: null };
  } catch { return { journal: null, error: 'invalid' }; }
}

export function loadWebLiveGameJournal(groupId: string, userId: string): ReadResult {
  if (typeof window === 'undefined') return { journal: null, error: null };
  try {
    const current = window.localStorage.getItem(storageKey(groupId, userId));
    if (current) return parseEnvelope(current, groupId, userId);
    const legacyKey = `${LEGACY_PREFIX}${groupId}`;
    const legacy = window.localStorage.getItem(legacyKey);
    if (!legacy) return { journal: null, error: null };
    let journal: WebLiveGameJournal;
    try { journal = parseWebLiveGameJournal(JSON.parse(legacy), groupId); }
    catch { return { journal: null, error: 'invalid' }; }
    // The old group-only key has no account owner. Membership alone is ambiguous.
    if (journal.record.created_by !== userId) return { journal: null, error: 'ownership' };
    const migrated = saveWebLiveGameJournal(groupId, journal, userId);
    if (!migrated.ok) return { journal, error: migrated.error };
    window.localStorage.removeItem(legacyKey);
    return { journal, error: null };
  } catch { return { journal: null, error: 'unavailable' }; }
}

export function saveWebLiveGameJournal(groupId: string, value: Omit<WebLiveGameJournal, 'savedAt'>, userId: string): WriteResult {
  if (typeof window === 'undefined') return { ok: false, error: 'unavailable' };
  try {
    const key = storageKey(groupId, userId);
    const existing = window.localStorage.getItem(key);
    if (existing) {
      const parsed = parseEnvelope(existing, groupId, userId);
      if (parsed.error) return { ok: false, error: parsed.error };
      if (parsed.journal && parsed.journal.record.id !== value.record.id && webJournalHasPendingOperations(parsed.journal)) {
        return { ok: false, error: 'pending_game' };
      }
    }
    const journal = parseWebLiveGameJournal({ ...value, savedAt: new Date().toISOString() }, groupId);
    if (journal.record.created_by !== userId && !journal.record.state.players.some(player => player.participantKey === `user:${userId}`)) {
      return { ok: false, error: 'ownership' };
    }
    const serialized = JSON.stringify({ schemaVersion: 2, accountId: userId, journal });
    window.localStorage.setItem(key, serialized);
    if (window.localStorage.getItem(key) !== serialized) return { ok: false, error: 'unavailable' };
    return { ok: true };
  } catch { return { ok: false, error: 'unavailable' }; }
}

export function clearWebLiveGameJournal(groupId: string, userId: string, liveGameId: string): WriteResult {
  if (typeof window === 'undefined') return { ok: false, error: 'unavailable' };
  try {
    const key = storageKey(groupId, userId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ok: true };
    const parsed = parseEnvelope(raw, groupId, userId);
    if (parsed.error) return { ok: false, error: parsed.error };
    if (parsed.journal?.record.id !== liveGameId) return { ok: false, error: 'pending_game' };
    window.localStorage.removeItem(key);
    return window.localStorage.getItem(key) === null ? { ok: true } : { ok: false, error: 'unavailable' };
  } catch { return { ok: false, error: 'unavailable' }; }
}
