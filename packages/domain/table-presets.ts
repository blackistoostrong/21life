import type {ParticipantKey} from './participant-keys';
import type {LiveGameRoundSeat} from './live-game-round';
import type {TableLayoutVariant} from './live-game-types';

export const TABLE_PRESET_LIMIT = 10;
export const TABLE_PRESET_NAME_LIMIT = 40;
export type TablePresetErrorKind = 'invalid' | 'unsupported' | 'scope' | 'name' | 'duplicate' | 'limit' | 'not_found' | 'storage' | 'cancelled' | 'references' | 'changed';

export class TablePresetError extends Error {
  constructor(readonly kind: TablePresetErrorKind) {
    super(`TABLE_PRESET_${kind.toUpperCase()}`);
  }
}

export type TablePresetScope = Readonly<{accountId: string; groupId: string}>;
export type TablePresetSeat = Readonly<{
  participantKey: ParticipantKey | null;
  deckId: string | null;
  deckKind: 'registered' | 'guest' | 'occasional' | null;
}>;
export type TablePresetDraft = Readonly<{
  playerCount: number;
  startingLife: number;
  layoutVariant: TableLayoutVariant;
  seats: readonly TablePresetSeat[];
}>;
/** Transient selected-reference labels; deliberately absent from persisted documents. */
export type TablePresetReference = LiveGameRoundSeat & Readonly<{
  deckName: string;
  bracket: string | null;
  sourceType: string | null;
  deckKind: 'registered' | 'guest' | 'occasional';
}>;
export type TablePresetV1 = TablePresetDraft & TablePresetScope & Readonly<{
  schemaVersion: 1;
  id: string;
  name: string;
  updatedAt: string;
}>;

export function normalizeTablePresetName(input: string): string {
  const name = input.trim().normalize('NFC');
  if (!name || Array.from(name).length > TABLE_PRESET_NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new TablePresetError('name');
  }
  return name;
}

export function tablePresetNameKey(name: string): string {
  return normalizeTablePresetName(name).toLowerCase();
}

/** Copy only setup preferences; never carry live state, credentials or card data. */
export function copyTablePresetDraft(draft: TablePresetDraft): TablePresetDraft {
  return {
    playerCount: draft.playerCount,
    startingLife: draft.startingLife,
    layoutVariant: draft.layoutVariant,
    seats: draft.seats.map(seat => ({
      participantKey: seat.participantKey,
      deckId: seat.deckId,
      deckKind: seat.deckKind,
    })),
  };
}

function assertScope(presets: readonly TablePresetV1[], scope: TablePresetScope): void {
  if (presets.some(preset => preset.accountId !== scope.accountId || preset.groupId !== scope.groupId)) {
    throw new TablePresetError('scope');
  }
}

function availableName(presets: readonly TablePresetV1[], input: string, exceptId?: string): string {
  const name = normalizeTablePresetName(input);
  const key = tablePresetNameKey(name);
  if (presets.some(preset => preset.id !== exceptId && tablePresetNameKey(preset.name) === key)) {
    throw new TablePresetError('duplicate');
  }
  return name;
}

/** Structural validation belongs to the codec; these are collection policies. */
export function addTablePreset(presets: readonly TablePresetV1[], scope: TablePresetScope,
  input: {id: string; name: string; updatedAt: string; draft: TablePresetDraft}): TablePresetV1[] {
  assertScope(presets, scope);
  if (presets.length >= TABLE_PRESET_LIMIT) throw new TablePresetError('limit');
  if (presets.some(preset => preset.id === input.id)) throw new TablePresetError('duplicate');
  const name = availableName(presets, input.name);
  return [...presets, {
    ...copyTablePresetDraft(input.draft),
    schemaVersion: 1,
    accountId: scope.accountId,
    groupId: scope.groupId,
    id: input.id,
    name,
    updatedAt: input.updatedAt,
  }];
}

export function renameTablePreset(presets: readonly TablePresetV1[], scope: TablePresetScope,
  id: string, input: string, updatedAt: string): TablePresetV1[] {
  assertScope(presets, scope);
  if (!presets.some(preset => preset.id === id)) throw new TablePresetError('not_found');
  const name = availableName(presets, input, id);
  return presets.map(preset => preset.id === id ? {...preset, name, updatedAt} : preset);
}

export function removeTablePreset(presets: readonly TablePresetV1[], scope: TablePresetScope, id: string): TablePresetV1[] {
  assertScope(presets, scope);
  if (!presets.some(preset => preset.id === id)) throw new TablePresetError('not_found');
  return presets.filter(preset => preset.id !== id);
}
