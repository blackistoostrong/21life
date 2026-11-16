import { z } from 'zod';
import { parseLiveGameState, type LiveGameRecord } from '@/lib/live-game';
import type { WebLiveGameJournal } from '@/lib/live-game-journal-types';
import type { ParticipantKey } from '@/lib/participant-keys';

const key = z.string().regex(/^(user|guest):.+$/).transform(value => value as ParticipantKey);
const number = z.number().finite();
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const player = z.object({ participantKey: key, deckId: z.string(), slot: number, life: number,
  displayName: z.string(), commander: z.string(), commanderImage: z.string().nullable(),
  infect: number, commanderDamageFrom: z.record(z.string(), number),
  counters: z.object({ energy: number, experience: number, commanderTax: number, monarch: z.boolean(), initiative: z.boolean() }),
  isEliminated: z.boolean(), eliminatedAt: timestamp.nullable(), backgroundColor: z.string().nullable().optional(),
});
const metadata = z.object({ eventId: z.string().optional(), occurredAt: timestamp.optional(),
  actionId: z.string().optional(), isCorrection: z.boolean().optional() });
const mutation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('adjust'), targetKey: key, amount: number, mode: z.enum(['life','commander','infect']), sourceKey: key.optional(),
    drain: z.boolean().optional(), drainAmount: number.optional(), groupScope: z.enum(['opponents','all_players']).optional() }),
  z.object({ type: z.literal('adjust_many'), sourceKey: key, amount: number, scope: z.enum(['opponents','all_players']),
    mode: z.enum(['life','infect']).optional(), drain: z.boolean().optional(), drainAmount: number.optional() }),
  z.object({ type: z.literal('last_standing'), winnerKey: key }),
  z.object({ type: z.literal('eliminate'), targetKey: key, eliminatedAt: timestamp }),
  z.object({ type: z.literal('revive'), targetKey: key, startingLife: number }),
  z.object({ type: z.literal('restore-player'), player }),
  z.object({ type: z.literal('adjust_counter'), targetKey: key, counter: z.enum(['energy','experience','commanderTax']), amount: number }),
  z.object({ type: z.literal('set_emblem'), targetKey: key, emblem: z.enum(['monarch','initiative']), active: z.boolean() }),
  z.object({ type: z.literal('restore_emblem'), emblem: z.enum(['monarch','initiative']), holderKey: key.nullable() }),
]).and(metadata);
const record = z.object({
  id: z.string().min(1), group_id: z.string().min(1), created_by: z.string().min(1),
  status: z.enum(['setup','active','ended','cancelled']), starting_life: number,
  state: z.object({ version: number.nonnegative(), players: z.array(z.object({ participantKey: key }).passthrough()).min(2).max(6) }).passthrough()
    .transform(value => parseLiveGameState(value))
    .refine(value => value.players.length >= 2 && new Set(value.players.map(item => item.participantKey)).size === value.players.length),
  match_id: z.string().nullable(), started_at: timestamp.nullable(), ended_at: timestamp.nullable(), created_at: timestamp, updated_at: timestamp,
}) satisfies z.ZodType<LiveGameRecord>;
const historyEntry = z.object({ forward: mutation, inverse: mutation });
const journal = z.object({
  record, serverRecord: record.optional(), needsCreate: z.boolean(),
  mutations: z.array(z.object({ id: z.string().min(1), mutation })),
  pendingFinalization: z.object({ winnerKey: key.nullable(), isDraw: z.boolean(),
    winCondition: z.enum(['last_standing','combo','concession','alternate_card','other']).nullable(), endedAt: timestamp,
    players: z.array(z.object({ participantKey: key, deckId: z.string(), isGuest: z.boolean(), userId: z.string().nullable(), guestId: z.string().nullable() })),
  }).nullable(),
  pendingCancel: z.boolean(), history: z.object({ undo: z.array(historyEntry).max(30), redo: z.array(historyEntry).max(30) }).default({ undo: [], redo: [] }),
  savedAt: timestamp,
});

export function parseWebLiveGameJournal(value: unknown, groupId: string): WebLiveGameJournal {
  const parsed = journal.parse(value);
  const serverRecord = parsed.serverRecord ?? parsed.record;
  if (parsed.record.group_id !== groupId || serverRecord.group_id !== groupId || serverRecord.id !== parsed.record.id
    || new Set(parsed.mutations.map(item => item.id)).size !== parsed.mutations.length) throw new Error('INVALID_JOURNAL');
  return { ...parsed, serverRecord };
}

export function webJournalHasPendingOperations(value: WebLiveGameJournal) {
  return value.needsCreate || value.mutations.length > 0 || value.pendingFinalization !== null || value.pendingCancel;
}
