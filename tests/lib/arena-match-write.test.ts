import { describe, expect, it, vi } from 'vitest';
import { buildArenaMatchWrite, getArenaMatchWriteFailureMessage, type ArenaMatchWriteInput } from '../../packages/domain/arena-match-write';
import { saveArenaMatch, type ArenaMatchWriteCommand } from '../../packages/data/arena-match-write';
import { saveArenaMatch as webSave } from '../../lib/arena-match-write';
import { saveArenaMatch as nativeSave } from '../../expo/lib/arena-match-write';

const input: ArenaMatchWriteInput = { mode: 'create', isDraw: false, winnerKey: 'guest:guest', notes: '  ', playedAt: '2026-11-20T20:15:00Z', winCondition: 'combo',
  players: [{ key: 'user:alice', deckId: 'user-deck' }, { key: 'guest:guest', deckId: 'guest-deck' }] };
const command: ArenaMatchWriteCommand = { actorId: 'actor', groupId: 'group', matchId: 'match', create: true, ...buildArenaMatchWrite(input) };

describe('shared manual match payload', () => {
  it('preserves notes/date and separates guest and user deck identities', () => {
    expect(buildArenaMatchWrite(input)).toEqual({
      header: { is_draw: false, winner_id: null, winner_guest_id: 'guest', notes: '  ', played_at: input.playedAt, win_condition: 'combo' },
      participants: [
        { user_id: 'alice', guest_id: null, deck_id: 'user-deck', guest_deck_id: null, is_winner: false },
        { user_id: null, guest_id: 'guest', deck_id: null, guest_deck_id: 'guest-deck', is_winner: true },
      ],
    });
    const userWinner = buildArenaMatchWrite({ ...input, winnerKey: 'user:alice', notes: '' });
    expect(userWinner.header.winner_id).toBe('alice'); expect(userWinner.header.notes).toBeNull();
  });
  it('draw overrides stale winner/condition fields and empty deck choices stay null', () => {
    const result = buildArenaMatchWrite({ ...input, isDraw: true, winnerKey: 'invalid', players: input.players.map(player => ({ ...player, deckId: '' })) });
    expect(result.header).toMatchObject({ winner_id: null, winner_guest_id: null, win_condition: null });
    expect(result.participants.every(participant => !participant.is_winner && participant.deck_id === null && participant.guest_deck_id === null)).toBe(true);
  });
  it('preserves edit IDs, unknown dates and optional platform-specific snapshot fields', () => {
    const result = buildArenaMatchWrite({ ...input, mode: 'edit', playedAt: null,
      players: input.players.map((player, index) => ({ ...player, id: `participant-${index}`, ...(index ? {} : { snapshotName: 'Alice' }) })) });
    expect(result.header.played_at).toBeNull(); expect(result.participants[0]).toMatchObject({ id: 'participant-0', participant_name_snapshot: 'Alice' });
    expect(result.participants[1]).not.toHaveProperty('participant_name_snapshot');
    expect(buildArenaMatchWrite({ ...input, players: input.players.map(player => ({ ...player, id: 'ignored', snapshotName: 'Ignored create label' })) }).participants[0])
      .not.toHaveProperty('id');
  });
  it('rejects missing/duplicate players and invalid winner before any transport', () => {
    expect(() => buildArenaMatchWrite({ ...input, players: [] })).toThrow('MATCH_PLAYERS_REQUIRED');
    for (const key of [null, 'invalid', 'user:']) expect(() => buildArenaMatchWrite({ ...input, players: [{ ...input.players[0], key }, input.players[1]] })).toThrow('MATCH_PARTICIPANT_INVALID');
    expect(() => buildArenaMatchWrite({ ...input, players: [input.players[0], input.players[0]] })).toThrow('MATCH_DUPLICATE_PLAYER');
    for (const winnerKey of [null, 'invalid', 'user:missing']) expect(() => buildArenaMatchWrite({ ...input, winnerKey })).toThrow('MATCH_WINNER_INVALID');
  });
  it('requires valid dates and unique existing participant IDs when editing', () => {
    for (const playedAt of [null, 'invalid']) expect(() => buildArenaMatchWrite({ ...input, playedAt })).toThrow('MATCH_DATE_INVALID');
    expect(() => buildArenaMatchWrite({ ...input, mode: 'edit' })).toThrow('MATCH_PARTICIPANT_ID_INVALID');
    expect(() => buildArenaMatchWrite({ ...input, mode: 'edit', players: input.players.map(player => ({ ...player, id: 'duplicate' })) })).toThrow('MATCH_PARTICIPANT_ID_INVALID');
  });
  it('maps known server failures to actionable IT/EN text, never raw SQL', () => {
    expect(getArenaMatchWriteFailureMessage({ code: 'PT409' }, 'en')).toBe('The battle changed. Reopen it and retry.');
    expect(getArenaMatchWriteFailureMessage({ code: '40001' }, 'it')).toContain('è cambiata');
    expect(getArenaMatchWriteFailureMessage({ code: '42501' }, 'en')).toContain('permission');
    expect(getArenaMatchWriteFailureMessage({ code: '23503', message: 'private_constraint_name' }, 'it')).toContain('Controlla');
    expect(getArenaMatchWriteFailureMessage(new Error('private_internal_detail'), 'en')).toBe('Saving failed. Please retry.');
  });
});

describe('shared atomic match transport', () => {
  it('sends one RPC with the captured actor, arena, request ID and complete snapshot', async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: 'match', error: null });
    const rpc = vi.fn().mockReturnValue({ abortSignal });
    expect(await saveArenaMatch({ rpc }, command)).toBe('match');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('save_arena_match_v1', {
      p_actor_id: 'actor', p_group_id: 'group', p_match_id: 'match', p_create: true,
      p_match: command.header, p_participants: command.participants,
    });
  });
  it.each([null, [], {}, 'another-match'])('rejects a missing or different ACK %j', async data => {
    await expect(saveArenaMatch({ rpc: vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error: null }) }) }, command))
      .rejects.toThrow('Match was not saved');
  });
  it('does not call RPC after cancellation or without private context', async () => {
    const rpc = vi.fn(); const controller = new AbortController(); controller.abort();
    await expect(saveArenaMatch({ rpc }, command, controller.signal)).rejects.toThrow('Operation aborted');
    for (const field of ['actorId', 'groupId', 'matchId'] as const) await expect(saveArenaMatch({ rpc }, { ...command, [field]: '' })).rejects.toThrow('Missing arena match context');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('propagates a missing RPC error without falling back to partial writes', async () => {
    const error = { code: 'PGRST202' }; const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error }) });
    await expect(saveArenaMatch({ rpc }, command)).rejects.toBe(error); expect(rpc).toHaveBeenCalledOnce();
  });
  it('drops an ACK if the context is cancelled at the acknowledgement boundary', async () => {
    const controller = new AbortController();
    const response = { data: 'match', get error() { controller.abort(); return null; } };
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue(response) });
    await expect(saveArenaMatch({ rpc }, command, controller.signal)).rejects.toThrow('Operation aborted');
  });
  it('aborts pending SDK I/O with the owning scope and its deadline', async () => {
    vi.useFakeTimers();
    try {
      for (const reason of ['scope', 'deadline'] as const) {
        const controller = new AbortController(); let transport!: AbortSignal;
        const rpc = vi.fn().mockReturnValue({ abortSignal: (signal: AbortSignal) => {
          transport = signal; return new Promise<{ data: unknown; error: null }>(() => {});
        } });
        const result = expect(saveArenaMatch({ rpc }, command, controller.signal)).rejects.toThrow(reason === 'scope' ? 'Operation aborted' : 'Operation timed out');
        if (reason === 'scope') controller.abort(); else await vi.advanceTimersByTimeAsync(15000);
        await result; expect(transport.aborted).toBe(true);
      }
    } finally { vi.useRealTimers(); }
  });
  const adapters = [
    ['web', (client: unknown) => webSave(client as Parameters<typeof webSave>[0], command)],
    ['native', (client: unknown) => nativeSave(client as Parameters<typeof nativeSave>[0], command)],
  ] as const;
  for (const [platform, save] of adapters) it(`${platform} adapter uses only its local SDK RPC`, async () => {
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: 'match', error: null }) });
    expect(await save({ rpc })).toBe('match'); expect(rpc).toHaveBeenCalledOnce();
  });
});
