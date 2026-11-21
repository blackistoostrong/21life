import { parseParticipantKey } from './participant-keys';
import type { WinCondition } from './live-game-types';

export type ArenaMatchHeaderWrite = {
  is_draw: boolean; winner_id: string | null; winner_guest_id: string | null;
  notes: string | null; played_at: string | null; win_condition: WinCondition | null;
};
export type ArenaMatchParticipantWrite = {
  id?: string; user_id: string | null; guest_id: string | null;
  deck_id: string | null; guest_deck_id: string | null; is_winner: boolean;
  participant_name_snapshot?: string;
};
export type ArenaMatchWriteInput = {
  mode: 'create' | 'edit'; isDraw: boolean; winnerKey: string | null;
  notes: string; playedAt: string | null; winCondition: WinCondition | null;
  players: ReadonlyArray<{ id?: string; key: string | null; deckId?: string | null; snapshotName?: string }>;
};

/** Same outcome/identity mapping for the web and native manual match forms. */
export function buildArenaMatchWrite(input: ArenaMatchWriteInput): {
  header: ArenaMatchHeaderWrite; participants: ArenaMatchParticipantWrite[];
} {
  if (input.players.length < 2) throw new Error('MATCH_PLAYERS_REQUIRED');
  if ((input.playedAt === null && input.mode === 'create')
    || (input.playedAt !== null && !Number.isFinite(Date.parse(input.playedAt)))) throw new Error('MATCH_DATE_INVALID');
  const keys = new Set<string>();
  const ids = new Set<string>();
  const participants = input.players.map(player => {
    const parsed = player.key ? parseParticipantKey(player.key) : null;
    if (!parsed || !player.key) throw new Error('MATCH_PARTICIPANT_INVALID');
    if (keys.has(player.key)) throw new Error('MATCH_DUPLICATE_PLAYER');
    keys.add(player.key);
    if (input.mode === 'edit') {
      if (!player.id || ids.has(player.id)) throw new Error('MATCH_PARTICIPANT_ID_INVALID');
      ids.add(player.id);
    }
    const guest = parsed.type === 'guest';
    const participant: ArenaMatchParticipantWrite = {
      user_id: guest ? null : parsed.id, guest_id: guest ? parsed.id : null,
      deck_id: guest ? null : player.deckId || null,
      guest_deck_id: guest ? player.deckId || null : null,
      is_winner: !input.isDraw && player.key === input.winnerKey,
    };
    if (input.mode === 'edit') participant.id = player.id;
    if (input.mode === 'edit' && player.snapshotName !== undefined) participant.participant_name_snapshot = player.snapshotName;
    return participant;
  });
  const winner = !input.isDraw && input.winnerKey ? parseParticipantKey(input.winnerKey) : null;
  if (!input.isDraw && (!winner || !input.winnerKey || !keys.has(input.winnerKey))) throw new Error('MATCH_WINNER_INVALID');
  return {
    header: { is_draw: input.isDraw, winner_id: winner?.type === 'user' ? winner.id : null,
      winner_guest_id: winner?.type === 'guest' ? winner.id : null,
      notes: input.notes || null, played_at: input.playedAt, win_condition: input.isDraw ? null : input.winCondition },
    participants,
  };
}

/** Give both clients an actionable message without exposing SQL/protocol details. */
export function getArenaMatchWriteFailureMessage(error: unknown, language: 'it' | 'en') {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
  const messages = code === 'PT409' || code === '40001'
    ? { it: 'La partita è cambiata. Riaprila e riprova.', en: 'The battle changed. Reopen it and retry.' }
    : code === '42501'
      ? { it: 'Non hai più il permesso di salvare questa partita.', en: 'You no longer have permission to save this battle.' }
      : ['23503', '23514', '22007', '22008', '22023', '22P02'].includes(code)
        ? { it: 'Giocatori, mazzi o data non più validi. Controlla la selezione e riprova.', en: 'Players, decks or date are no longer valid. Check the selection and retry.' }
        : { it: 'Salvataggio non riuscito. Riprova.', en: 'Saving failed. Please retry.' };
  return messages[language];
}
