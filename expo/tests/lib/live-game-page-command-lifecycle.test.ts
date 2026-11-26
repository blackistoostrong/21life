import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { beforeEach, expect, it, vi } from 'vitest';
import {createNativeLiveSessionJournal} from '@/lib/native-live-session-journal';
import {isValidLiveGameResult} from '@/lib/live-game';
import {parseParticipantKey} from '@/lib/participant-keys';
import { createLiveGameRound } from '../../../packages/domain/live-game-round';
const io=vi.hoisted(()=>({archive:vi.fn(),save:vi.fn(),clear:vi.fn(),load:vi.fn(),replace:vi.fn()}));
vi.mock('@/lib/live-game-offline',()=>({archiveAndClearLiveGameSession:io.archive,saveLiveGameOfflineSession:io.save,
 clearLiveGameOfflineSessionIfMatches:io.clear,loadLiveGameOfflineSession:io.load,prepareLiveGameReplacement:io.replace}));
beforeEach(()=>{Object.values(io).forEach(mock=>mock.mockReset().mockResolvedValue(undefined));});

// Execute the shipped handlers, extracted by the installed TS parser. Only I/O
// and UI ports are replaced; this is not a second implementation of commands.
const source = ['app/table/[id]/play.tsx','hooks/use-native-live-round-commands.ts'].map(file=>readFileSync(file,'utf8')).join('\n');
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
function gameRecord(actor='actor-a',id='game-a'){
 return createLiveGameRound({id,groupId:'group-a',actorId:actor,startedAt:'2026-11-25T10:00:00Z',startingLife:40,layoutVariant:'classic',random:()=>0,
 seats:[{participantKey:`user:${actor}`,deckId:'deck-a',displayName:actor,commander:'A',commanderImage:null},
 {participantKey:'guest:g',deckId:'deck-g',displayName:'Guest',commander:'G',commanderImage:null}]});
}
function fixture() {
 let current=true;let busy=false;const game=gameRecord();
 const journal=createNativeLiveSessionJournal('group-a','actor-a',{isCurrent:()=>current,randomUUID});
 journal.activate();journal.start(game);journal.acceptCreated(game);
 const ports:Record<string,unknown>={
  journal,user:{id:'actor-a'},currentUserId:'actor-a',groupId:'group-a',liveGame:game,
  endingGame:false,discardingGame:false,endIsDraw:true,endWinnerKey:'',endWinCondition:null,
  activePlayers:game.state.players,isValidLiveGameResult,parseParticipantKey,isLiveScopeCurrent:()=>current,
  beginLiveCommand:()=>{if(!current||busy)return null;busy=true;return{isCurrent:()=>current,release:()=>{busy=false;}};},
  archiveAndClearLiveGameSession:io.archive,flushArchivedOutbox:vi.fn(),cancelScheduledSync:vi.fn(),saveJournal:vi.fn().mockResolvedValue(undefined),
  showToast:vi.fn(),copy:(key:string)=>key,hapticSuccess:vi.fn(),router:{replace:vi.fn()},
  onEvent:vi.fn(),
  getGameDurationSeconds:()=>42,formatGameDuration:()=>'42s',publishRecord:vi.fn(),
  setupReadyKey:'actor-a:group-a',selectedKeys:['user:actor-a'],playerCount:1,getDeckOptions:()=>[],participantDecks:{},
  resolveMeta:()=>({deckId:'deck-a'}),withLiveGameTimeout:(job:Promise<unknown>)=>job,fetchBusyLiveGameParticipantKeys:vi.fn(),
  bindLiveClient:()=>({client:'actor-a-client'}),Crypto:{randomUUID},createLiveGameRound,startingLife:40,layoutVariant:'classic',seatSetups:[],
  saveLiveGameSetup:vi.fn().mockResolvedValue(undefined),revealStartingPlayer:vi.fn(),syncJournal:vi.fn(),preparePreviousPod:()=>game,
 };
 for(const match of source.matchAll(/\b(set[A-Z]\w*)\b/g))ports[match[1]]??=vi.fn();
 for(const match of source.matchAll(/\b(\w+Ref)\b/g))ports[match[1]]??={current:null};
 ports.onEvent=vi.fn((event:unknown)=>Reflect.apply(handler('onRoundEvent',ports),null,[event]));
 journal.view.subscribe((value,previous)=>{if(value.record!==previous.record)(ports.publishRecord as (record:unknown)=>void)(value.record);});
 return {ports,journal,expire:()=>{current=false;journal.deactivate();},game};
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
  expect(ports.publishRecord).not.toHaveBeenCalled();
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
    expect((ports.journal as ReturnType<typeof createNativeLiveSessionJournal>).getSnapshot().serverRecord).toBeNull();
    expect(ports.publishRecord).toHaveBeenCalledWith(null);
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
      const next=gameRecord('actor-b','game-b');
      const nextJournal=createNativeLiveSessionJournal('group-a','actor-b',{isCurrent:()=>true,randomUUID});
      nextJournal.activate();nextJournal.start(next);
      vi.clearAllMocks();
      settle(); await pending;
      expect(nextJournal.getSnapshot().serverRecord).toBe(next);
      expect(nextJournal.getSnapshot().closed).toBe(false);
      expect(ports.publishRecord).not.toHaveBeenCalled();
      expect(ports.setShowRematch).not.toHaveBeenCalled();
      expect(ports.setShowEndGame).not.toHaveBeenCalled();
      expect(ports.onEvent).not.toHaveBeenCalled();
      expect(ports.flushArchivedOutbox).not.toHaveBeenCalled();
      expect(ports.saveJournal).not.toHaveBeenCalled();
      expect(ports.showToast).not.toHaveBeenCalled();
      expect((ports.router as { replace: unknown }).replace).not.toHaveBeenCalled();
    });
  }
}
