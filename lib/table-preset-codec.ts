import {z} from 'zod';
import {parseParticipantKey, type ParticipantKey} from '../packages/domain/participant-keys';
import {LIVE_GAME_MIN_PLAYERS, LIVE_GAME_MAX_PLAYERS} from '../packages/domain/live-game-types';
import {
  TABLE_PRESET_LIMIT, TablePresetError, normalizeTablePresetName, tablePresetNameKey,
  type TablePresetScope, type TablePresetV1,
} from '../packages/domain/table-presets';

const MAX_DOCUMENT_LENGTH = 65536;
const uuid = z.uuid();
const scopeSchema = z.strictObject({accountId: uuid, groupId: uuid});
const participant = z.custom<ParticipantKey>(value => {
  if (typeof value !== 'string') return false;
  const key = parseParticipantKey(value);
  return key !== null && uuid.safeParse(key.id).success;
});
const name = z.string().refine(value => {
  try {return normalizeTablePresetName(value) === value;} catch {return false;}
});
const seat = z.strictObject({
  participantKey: participant.nullable(),
  deckId: uuid.nullable(),
  deckKind: z.enum(['registered', 'guest', 'occasional']).nullable(),
}).refine(value => {
  if (!value.participantKey) return value.deckId === null && value.deckKind === null;
  if (!value.deckId) return value.deckKind === null;
  return value.participantKey.startsWith('guest:')
    ? value.deckKind === 'guest'
    : value.deckKind === 'registered' || value.deckKind === 'occasional';
});
const preset = z.strictObject({
  schemaVersion: z.literal(1),
  id: uuid,
  name,
  accountId: uuid,
  groupId: uuid,
  updatedAt: z.iso.datetime({offset: true}),
  playerCount: z.number().int().min(LIVE_GAME_MIN_PLAYERS).max(LIVE_GAME_MAX_PLAYERS),
  startingLife: z.number().int().positive(),
  layoutVariant: z.enum(['classic', 'opposed']),
  seats: z.array(seat).min(LIVE_GAME_MIN_PLAYERS).max(LIVE_GAME_MAX_PLAYERS),
}).refine(value => {
  const keys = value.seats.flatMap(value => value.participantKey ? [value.participantKey] : []);
  return value.seats.length === value.playerCount && new Set(keys).size === keys.length;
});
const documentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accountId: uuid,
  groupId: uuid,
  presets: z.array(preset).max(TABLE_PRESET_LIMIT),
}).refine(value => {
  const ids = new Set(value.presets.map(preset => preset.id));
  const names = new Set(value.presets.map(preset => tablePresetNameKey(preset.name)));
  return ids.size === value.presets.length && names.size === value.presets.length
    && value.presets.every(preset => preset.accountId === value.accountId && preset.groupId === value.groupId);
});

export function validateTablePresetScope(scope: TablePresetScope): void {
  if (!scopeSchema.safeParse(scope).success) throw new TablePresetError('scope');
}

/** Unknown schemas and malformed documents are errors, never empty collections. */
export function decodeTablePresets(raw: string | null, scope: TablePresetScope): TablePresetV1[] {
  validateTablePresetScope(scope);
  if (raw === null) return [];
  if (!raw || raw.length > MAX_DOCUMENT_LENGTH) throw new TablePresetError('invalid');
  let input: unknown;
  try {input = JSON.parse(raw);} catch {throw new TablePresetError('invalid');}
  const header = z.object({schemaVersion: z.number()}).safeParse(input);
  if (header.success && header.data.schemaVersion !== 1) throw new TablePresetError('unsupported');
  const result = documentSchema.safeParse(input);
  if (!result.success) throw new TablePresetError('invalid');
  if (result.data.accountId !== scope.accountId || result.data.groupId !== scope.groupId) {
    throw new TablePresetError('scope');
  }
  return result.data.presets;
}

export function encodeTablePresets(presets: readonly TablePresetV1[], scope: TablePresetScope): string {
  validateTablePresetScope(scope);
  const result = documentSchema.safeParse({schemaVersion: 1, accountId: scope.accountId, groupId: scope.groupId, presets});
  if (!result.success) throw new TablePresetError('invalid');
  return JSON.stringify(result.data);
}
