import { describe, expect, it, vi } from 'vitest';
import { createLiveGamePlayer, type LiveGameRecord } from '@/lib/live-game';
import { fetchActiveLiveGame, fetchLiveGameByMatchId } from '@/lib/live-game-service';

function record(overrides: Partial<LiveGameRecord> = {}): LiveGameRecord {
  return {
    id: 'live-1',
    group_id: 'group-1',
    created_by: 'a',
    status: 'active',
    starting_life: 40,
    state: {
      version: 0,
      events: [],
      players: [createLiveGamePlayer({
        slot: 0,
        participantKey: 'user:a',
        deckId: 'deck-a',
        displayName: 'A',
        commander: 'Atraxa',
        commanderImage: null,
        startingLife: 40,
        allParticipantKeys: ['user:a'],
      })],
    },
    match_id: null,
    started_at: '2026-07-16T10:00:00.000Z',
    ended_at: null,
    created_at: '2026-07-16T10:00:00.000Z',
    updated_at: '2026-07-16T10:00:00.000Z',
    ...overrides,
  };
}

function selectQuery(result: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  ['select', 'eq', 'limit', 'order', 'or', 'abortSignal'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query);
  });
  query.maybeSingle = vi.fn().mockReturnValue(Promise.resolve(result));
  return query;
}

describe('web active live game lookup', () => {
  it('does not start SDK I/O with an already cancelled scope', async () => {
    const controller = new AbortController(); controller.abort(); const client = { from: vi.fn() };
    await expect(fetchActiveLiveGame(client as never, 'group-1', 'user:a', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.from).not.toHaveBeenCalled();
  });
  it.each([null, { live_game_id: 'live-1' }])('does not continue the query chain after cancellation, participation %j', async participant => {
    const controller = new AbortController(), query = selectQuery(null);
    let resolve!: (value: unknown) => void;
    query.maybeSingle.mockReturnValue(new Promise(done => { resolve = done; }));
    const client = { from: vi.fn().mockReturnValue(query) };
    const result = fetchActiveLiveGame(client as never, 'group-1', 'user:a', controller.signal);
    controller.abort(); resolve({ data: participant, error: null });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.from).toHaveBeenCalledOnce(); expect(query.abortSignal).toHaveBeenCalledWith(controller.signal);
  });
  it.each([false, true])('carries the same SDK signal through the full lookup, participation %j', async participating => {
    const signal = new AbortController().signal;
    const participantQuery = selectQuery({ data: participating ? { live_game_id: 'live-1' } : null, error: null });
    const gameQuery = selectQuery({ data: record(), error: null });
    const client = { from: vi.fn().mockReturnValueOnce(participantQuery).mockReturnValueOnce(gameQuery) };
    expect((await fetchActiveLiveGame(client as never, 'group-1', 'user:a', signal))?.id).toBe('live-1');
    expect(participantQuery.abortSignal).toHaveBeenCalledExactlyOnceWith(signal);
    expect(gameQuery.abortSignal).toHaveBeenCalledExactlyOnceWith(signal);
  });
  it('filters participant rows to the active, non-eliminated game', async () => {
    const participantQuery = selectQuery({ data: null, error: null });
    const creatorQuery = selectQuery({ data: null, error: null });
    const client = { from: vi.fn().mockReturnValueOnce(participantQuery).mockReturnValueOnce(creatorQuery) };
    expect(await fetchActiveLiveGame(client as never, 'group-1', 'user:a')).toBeNull();
    expect(participantQuery.eq).toHaveBeenCalledWith('status', 'active');
    expect(participantQuery.eq).toHaveBeenCalledWith('is_eliminated', false);
    expect(creatorQuery.eq).toHaveBeenCalledWith('created_by', 'a');
    expect(creatorQuery.order).toHaveBeenCalledWith('updated_at', { ascending: false });
  });

  it('returns the active participation before considering the creator fallback', async () => {
    const participantQuery = selectQuery({ data: { live_game_id: 'live-1' }, error: null });
    const gameQuery = selectQuery({ data: record(), error: null });
    const client = { from: vi.fn().mockReturnValueOnce(participantQuery).mockReturnValueOnce(gameQuery) };
    expect((await fetchActiveLiveGame(client as never, 'group-1', 'user:a'))?.id).toBe('live-1');
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it('does not fall back to another created game when the authoritative game ended', async () => {
    const participantQuery = selectQuery({ data: { live_game_id: 'live-1' }, error: null });
    const gameQuery = selectQuery({ data: record({ status: 'ended' }), error: null });
    const client = { from: vi.fn().mockReturnValueOnce(participantQuery).mockReturnValueOnce(gameQuery) };
    expect(await fetchActiveLiveGame(client as never, 'group-1', 'user:a')).toBeNull();
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it('throws instead of clearing the journal when the authoritative game row is unreadable', async () => {
    const participantQuery = selectQuery({ data: { live_game_id: 'live-1' }, error: null });
    const gameQuery = selectQuery({ data: null, error: null });
    const client = { from: vi.fn().mockReturnValueOnce(participantQuery).mockReturnValueOnce(gameQuery) };
    await expect(fetchActiveLiveGame(client as never, 'group-1', 'user:a'))
      .rejects.toThrow('Live game is not readable');
  });

  it('keeps host resume when the host has been eliminated', async () => {
    const participantQuery = selectQuery({ data: null, error: null });
    const creatorQuery = selectQuery({ data: record({ id: 'live-host' }), error: null });
    const client = { from: vi.fn().mockReturnValueOnce(participantQuery).mockReturnValueOnce(creatorQuery) };
    expect((await fetchActiveLiveGame(client as never, 'group-1', 'user:a'))?.id).toBe('live-host');
  });

  it('does not fall back to created games for guests', async () => {
    const participantQuery = selectQuery({ data: null, error: null });
    const client = { from: vi.fn().mockReturnValue(participantQuery) };
    expect(await fetchActiveLiveGame(client as never, 'group-1', 'guest:g1')).toBeNull();
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});

describe('web historical live game lookup', () => {
  it('scopes a legacy recap to the captured match and group with its SDK cancellation signal', async () => {
    const query = selectQuery({ data: record({ status: 'ended', match_id: 'match-1' }), error: null });
    const client = { from: vi.fn().mockReturnValue(query) }, signal = new AbortController().signal;
    const result = await fetchLiveGameByMatchId(client as never, 'match-1', { groupId: 'group-1', signal });
    expect(result?.id).toBe('live-1'); expect(result?.state.players).toHaveLength(1);
    expect(client.from).toHaveBeenCalledExactlyOnceWith('live_games');
    expect(query.eq.mock.calls).toEqual([['match_id', 'match-1'], ['group_id', 'group-1']]);
    expect(query.abortSignal).toHaveBeenCalledExactlyOnceWith(signal);
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });
  it('preserves missing legacy rows and callers without explicit scope', async () => {
    const query = selectQuery({ data: null, error: null });
    expect(await fetchLiveGameByMatchId({ from: vi.fn().mockReturnValue(query) } as never, 'match-1')).toBeNull();
    expect(query.eq.mock.calls).toEqual([['match_id', 'match-1']]); expect(query.abortSignal).not.toHaveBeenCalled();
  });
  it('does not discard a supplied empty group filter or hide an SDK failure', async () => {
    const error = { code: '42501' }, query = selectQuery({ data: null, error });
    await expect(fetchLiveGameByMatchId({ from: vi.fn().mockReturnValue(query) } as never, 'match-1', { groupId: '' })).rejects.toBe(error);
    expect(query.eq).toHaveBeenCalledWith('group_id', ''); expect(query.abortSignal).not.toHaveBeenCalled();
  });
});
