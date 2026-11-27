import {
  copyTablePresetDraft, TablePresetError,
  type TablePresetDraft, type TablePresetReference, type TablePresetV1,
} from '../domain/table-presets';
import {reconcileLiveGameReferences, type LiveGameReferenceIssue} from '../domain/live-game-reference-validation';
import {readLiveGameRoundReferences, type LiveGameReferenceReader} from './live-game-round-references';

export type PreparedTablePreset = Readonly<{
  draft: TablePresetDraft;
  references: readonly TablePresetReference[];
  issues: readonly LiveGameReferenceIssue[];
}>;

/** Read selected IDs only. Missing/archived choices are cleared, never replaced or inserted. */
export async function prepareTablePresetReferences(preset: TablePresetV1, reader: LiveGameReferenceReader,
  signal?: AbortSignal): Promise<PreparedTablePreset> {
  let result: Awaited<ReturnType<typeof readLiveGameRoundReferences>>;
  try {
    result = await readLiveGameRoundReferences(reader, {
      groupId: preset.groupId, actorId: preset.accountId, seats: preset.seats,
    }, signal);
  } catch {
    throw new TablePresetError(signal?.aborted ? 'cancelled' : 'references');
  }
  if (signal?.aborted) throw new TablePresetError('cancelled');
  if (result.kind === 'denied') throw new TablePresetError('scope');
  const participants = result.participants;
  const plan = reconcileLiveGameReferences(preset.seats, participants, {allowArchived: false});
  const references: TablePresetReference[] = plan.resolved.map(seat => {
    const participant = participants.find(participant => participant.key === seat.participantKey);
    const deck = participant?.decks.find(deck => deck.id === seat.deckId);
    if (!deck) throw new TablePresetError('references');
    return {
      ...seat,
      deckName: deck.name || deck.commander || '—',
      bracket: deck.bracket ?? null,
      sourceType: deck.sourceType ?? null,
      deckKind: seat.participantKey.startsWith('guest:') ? 'guest'
        : deck.sourceType === 'occasional' ? 'occasional' : 'registered',
    };
  });
  return {
    draft: {
      ...copyTablePresetDraft(preset),
      seats: plan.seats.map(seat => ({
        ...seat,
        deckKind: references.find(reference => reference.participantKey === seat.participantKey
          && reference.deckId === seat.deckId)?.deckKind ?? null,
      })),
    },
    references,
    issues: plan.issues,
  };
}
