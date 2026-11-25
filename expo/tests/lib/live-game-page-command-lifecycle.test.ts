import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

// Execute the shipped handlers, extracted by the installed TS parser. Only I/O
// and UI ports are replaced; this is not a second implementation of commands.
const source = readFileSync('app/table/[id]/play.tsx', 'utf8');
function handler(name: string, ports: Record<string, unknown>) {
  const ast = ts.createSourceFile('play.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!expression) throw Error(`Missing production handler ${name}`);
  const javascript = ts.transpile(`const command = ${expression.getText(ast)};`, { target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(ports), `${javascript};return command;`)(...Object.values(ports)) as () => Promise<void>;
}
function fixture() {
  let current = true;
  let busy = false;
  const game = { id: 'game-a', started_at: '2026-11-25T10:00:00Z', state: { players: [] } };
  const ports: Record<string, unknown> = {
    user: { id: 'actor-a' }, currentUserId: 'actor-a', groupId: 'group-a', liveGame: game,
    endingGame: false, discardingGame: false, endIsDraw: true, endWinnerKey: '', endWinCondition: null,
    activePlayers: [], isValidLiveGameResult: () => true,
    isLiveScopeCurrent: () => current,
    beginLiveCommand: () => {
      if (!current || busy) return null;
      busy = true;
      return { isCurrent: () => current, release: () => { busy = false; } };
    },
    archiveAndClearLiveGameSession: vi.fn(), clearLiveGameOfflineSessionIfMatches: vi.fn(),
    flushArchivedOutbox: vi.fn(), saveJournal: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(), copy: (key: string) => key, hapticSuccess: vi.fn(),
    router: { replace: vi.fn() }, createLiveGameHistory: () => ({}),
    setOptimisticRecord: vi.fn(), getGameDurationSeconds: () => 42, formatGameDuration: () => '42s',
    setupReadyKey: 'actor-a:group-a', selectedKeys: ['user:actor-a'], playerCount: 1,
    getDeckOptions: () => [], participantDecks: {}, resolveMeta: () => ({ deckId: 'deck-a' }),
    withLiveGameTimeout: (job: Promise<unknown>) => job, fetchBusyLiveGameParticipantKeys: vi.fn(),
    bindLiveClient: () => ({ client: 'actor-a-client' }), supabase: 'shared-client',
    createLiveGamePlayer: (input: unknown) => input, Crypto: { randomUUID },
    createLiveGameSummary: () => ({}), startingLife: 40, layoutVariant: 'classic', seatSetups: [],
    saveLiveGameSetup: vi.fn().mockResolvedValue(undefined), revealStartingPlayer: vi.fn(), syncJournal: vi.fn(),
    preparePreviousPod: () => ({ ...game, starting_life: 40 }),
  };
  for (const match of source.matchAll(/\b(set[A-Z]\w*)\b/g)) ports[match[1]] ??= vi.fn();
  for (const match of source.matchAll(/\b(\w+Ref)\b/g)) ports[match[1]] ??= { current: null };
  Object.assign(ports, {
    liveGameRef: { current: game }, serverRecordRef: { current: game },
    mutationQueueRef: { current: [] }, needsCreateRef: { current: false },
    sessionClosedRef: { current: false }, journalWriteRef: { current: Promise.resolve() },
  });
  return { ports, expire: () => { current = false; }, game };
}

it('start does not create a game after account change during the busy-player lookup', async () => {
  const { ports, expire } = fixture();
  let reply!: (keys: string[]) => void;
  vi.mocked(ports.fetchBusyLiveGameParticipantKeys as ReturnType<typeof vi.fn>).mockImplementation(() =>
    new Promise<string[]>(resolve => { reply = resolve; }));
  const pending = handler('handleStart', ports)();
  expect(ports.fetchBusyLiveGameParticipantKeys).toHaveBeenCalledTimes(1);
  const args = vi.mocked(ports.fetchBusyLiveGameParticipantKeys as ReturnType<typeof vi.fn>).mock.calls[0];
  expire(); vi.clearAllMocks(); reply([]); await pending;
  expect(ports.setOptimisticRecord).not.toHaveBeenCalled();
  expect(ports.saveLiveGameSetup).not.toHaveBeenCalled();
  expect(ports.saveJournal).not.toHaveBeenCalled();
  expect(ports.showToast).not.toHaveBeenCalled();
  expect(ports.setStarting).not.toHaveBeenCalled();
  expect(args).toEqual(['actor-a-client', 'group-a', ['user:actor-a']]);
});

it('rematch does not trigger sync after its journal finishes in another account', async () => {
  const { ports, expire } = fixture();
  let reply!: () => void;
  vi.mocked(ports.saveJournal as ReturnType<typeof vi.fn>).mockImplementation(() =>
    new Promise<void>(resolve => { reply = resolve; }));
  const pending = handler('handleRematchSameDecks', ports)();
  expect(ports.saveJournal).toHaveBeenCalledTimes(1);
  expire(); vi.clearAllMocks(); reply(); await pending;
  expect(ports.syncJournal).not.toHaveBeenCalled();
});
for (const name of ['handleDiscardGame', 'handleEndGame']) {
  it(`${name} still completes archival, UI cleanup and outbox replay for the current account`, async () => {
    const { ports } = fixture();
    await handler(name, ports)();
    expect(ports.archiveAndClearLiveGameSession).toHaveBeenCalledTimes(1);
    expect((ports.serverRecordRef as { current: unknown }).current).toBeNull();
    expect(ports.setOptimisticRecord).toHaveBeenCalledWith(null);
    expect(ports.flushArchivedOutbox).toHaveBeenCalledTimes(1);
    expect(ports.showToast).toHaveBeenCalledTimes(1);
    if (name === 'handleDiscardGame') expect((ports.router as { replace: unknown }).replace).toHaveBeenCalledWith('/table/group-a');
    else expect(ports.setShowRematch).toHaveBeenCalledWith(true);
  });
  for (const fails of [false, true]) {
    it(`${name} preserves the next account after a late archive ${fails ? 'failure' : 'success'}`, async () => {
      const { ports, expire } = fixture();
      let settle!: () => void;
      vi.mocked(ports.archiveAndClearLiveGameSession as ReturnType<typeof vi.fn>).mockImplementation(() =>
        new Promise<void>((resolve, reject) => { settle = () => fails ? reject(Error('storage unavailable')) : resolve(); }));
      const run = handler(name, ports);
      const pending = run();
      expect(ports.archiveAndClearLiveGameSession).toHaveBeenCalledTimes(1);
      expect(vi.mocked(ports.archiveAndClearLiveGameSession as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe('actor-a');
      expire();
      const next = { id: 'game-b' };
      (ports.serverRecordRef as { current: unknown }).current = next;
      (ports.sessionClosedRef as { current: boolean }).current = false;
      vi.clearAllMocks();
      settle(); await pending;
      expect((ports.serverRecordRef as { current: unknown }).current).toBe(next);
      expect((ports.sessionClosedRef as { current: boolean }).current).toBe(false);
      expect(ports.setOptimisticRecord).not.toHaveBeenCalled();
      expect(ports.setShowRematch).not.toHaveBeenCalled();
      expect(ports.setShowEndGame).not.toHaveBeenCalled();
      expect(ports.flushArchivedOutbox).not.toHaveBeenCalled();
      expect(ports.saveJournal).not.toHaveBeenCalled();
      expect(ports.showToast).not.toHaveBeenCalled();
      expect((ports.router as { replace: unknown }).replace).not.toHaveBeenCalled();
    });
  }
}
