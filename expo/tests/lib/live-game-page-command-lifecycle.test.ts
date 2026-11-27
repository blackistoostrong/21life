import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { beforeEach, expect, it, vi } from 'vitest';
import {createNativeLiveSessionJournal} from '@/lib/native-live-session-journal';
import {isValidLiveGameResult} from '@/lib/live-game';
import {parseParticipantKey} from '@/lib/participant-keys';
import { createLiveGameRound } from '../../../packages/domain/live-game-round';
import {LiveGameReferenceReadError} from '../../../packages/data/live-game-round-references';
import {reconcileLiveGameReferences,liveGameReferenceStamp} from '../../../packages/domain/live-game-reference-validation';
const io=vi.hoisted(()=>({archive:vi.fn(),save:vi.fn(),clear:vi.fn(),load:vi.fn(),replace:vi.fn()}));
vi.mock('@/lib/live-game-offline',()=>({archiveAndClearLiveGameSession:io.archive,saveLiveGameOfflineSession:io.save,
 clearLiveGameOfflineSessionIfMatches:io.clear,loadLiveGameOfflineSession:io.load,prepareLiveGameReplacement:io.replace}));
beforeEach(()=>{Object.values(io).forEach(mock=>mock.mockReset().mockResolvedValue(undefined));});

// Execute the shipped handlers, extracted by the installed TS parser. Only I/O
// and UI ports are replaced; this is not a second implementation of commands.
const source = ['app/table/[id]/play.tsx','hooks/use-native-live-round-commands.ts','hooks/use-native-live-rematch.ts'].map(file=>readFileSync(file,'utf8')).join('\n');
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
 const opening={open:true};
 const ports:Record<string,unknown>={
  LiveGameReferenceReadError,opening,openingRef:{current:opening},networkOnline:false,starting:false,
  journal,user:{id:'actor-a'},currentUserId:'actor-a',groupId:'group-a',liveGame:game,completedGame:game,
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
  saveLiveGameSetup:vi.fn().mockResolvedValue(undefined),revealStartingPlayer:vi.fn(),syncJournal:vi.fn(),
  applySeatSetups:vi.fn(),applyStartingLife:vi.fn(),
 };
 for(const match of source.matchAll(/\b(set[A-Z]\w*)\b/g))ports[match[1]]??=vi.fn();
 for(const match of source.matchAll(/\b(\w+Ref)\b/g))ports[match[1]]??={current:null};
 ports.onEvent=vi.fn((event:unknown)=>Reflect.apply(handler('onRoundEvent',ports),null,[event]));
 ports.preparePreviousPod=handler('preparePreviousPod',ports);
 journal.view.subscribe((value,previous)=>{if(value.record!==previous.record)(ports.publishRecord as (record:unknown)=>void)(value.record);});
 return {ports,journal,expire:()=>{current=false;journal.deactivate();},game};
}

for(const unavailable of ['participant','deck','busy'] as const){
 it(`rematch does not create or persist a new round when its ${unavailable} is unavailable`,async()=>{
  const {ports,journal,game}=fixture();
  const participants=game.state.players.map(player=>({key:player.participantKey,displayName:player.displayName,
   decks:[{id:player.deckId,commander:player.commander,commanderImage:player.commanderImage}]}));
  if(unavailable==='participant')participants.splice(1,1);
  if(unavailable==='deck')participants[0].decks=[];
  ports.networkOnline=true;ports.epoch={};ports.referenceRequestRef={current:null};
  ports.readReferenceStamp=()=>liveGameReferenceStamp(game.state.players,participants);
  ports.reconcileLiveGameReferences=reconcileLiveGameReferences;
  ports.createLiveGameReferenceReader=(client:unknown)=>client;
  ports.readLiveGameRoundReferences=vi.fn().mockResolvedValue({kind:'ready',participants});
  vi.mocked(ports.fetchBusyLiveGameParticipantKeys as ReturnType<typeof vi.fn>).mockResolvedValue(unavailable==='busy'?['guest:g']:[]);
  await handler('handleRematchSameDecks',ports)();
  expect(journal.getSnapshot().record?.id).toBe(game.id);
  expect(ports.saveJournal).not.toHaveBeenCalled();expect(ports.syncJournal).not.toHaveBeenCalled();
  expect(ports.showToast).toHaveBeenCalled();
 });
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

function onlineRematch(){
 const value=fixture();const {ports,game}=value;
 const participants=game.state.players.map(player=>({key:player.participantKey,displayName:`Current ${player.displayName}`,
  decks:[{id:player.deckId,commander:`Current ${player.commander}`,commanderImage:null}]}));
 Object.assign(ports,{networkOnline:true,readReferenceStamp:()=>liveGameReferenceStamp(game.state.players,participants),
  reconcileLiveGameReferences,createLiveGameReferenceReader:(client:unknown)=>client,
  readLiveGameRoundReferences:vi.fn().mockResolvedValue({kind:'ready',participants})});
 vi.mocked(ports.fetchBusyLiveGameParticipantKeys as ReturnType<typeof vi.fn>).mockResolvedValue([]);
 return {...value,participants};
}
it('online rematch reads the selected IDs, excludes only the previous round and resets sorted seats using current metadata',async()=>{
 const {ports,journal,game}=onlineRematch();
 game.state.players.reverse();game.state.players.forEach(player=>{player.life=3;player.infect=8;player.isEliminated=true;});
 await handler('handleRematchSameDecks',ports)();
 expect(ports.fetchBusyLiveGameParticipantKeys).toHaveBeenCalledWith('actor-a-client','group-a',['user:actor-a','guest:g'],
  {excludeLiveGameId:game.id,signal:expect.any(AbortSignal)});
 expect(ports.readLiveGameRoundReferences).toHaveBeenCalledWith('actor-a-client',
  {groupId:'group-a',actorId:'actor-a',seats:[{participantKey:'user:actor-a',deckId:'deck-a'},{participantKey:'guest:g',deckId:'deck-g'}]},expect.any(AbortSignal));
 const next=journal.getSnapshot().record!;expect(next.id).not.toBe(game.id);
 expect(next.state.players.map(player=>[player.participantKey,player.deckId,player.displayName,player.commander,player.life,player.isEliminated]))
  .toEqual([['user:actor-a','deck-a','Current actor-a','Current A',40,false],['guest:g','deck-g','Current Guest','Current G',40,false]]);
 expect(game.state.players[0].life).toBe(3);expect(ports.saveJournal).toHaveBeenCalledOnce();expect(ports.syncJournal).toHaveBeenCalledOnce();
});
for(const invalidation of ['account','recap-close'] as const){
 it(`rematch rejects a late reference response after ${invalidation}`,async()=>{
  const {ports,expire,journal,game,participants}=onlineRematch();let reply!:(value:unknown)=>void;
  vi.mocked(ports.readLiveGameRoundReferences as ReturnType<typeof vi.fn>).mockImplementation(()=>new Promise(resolve=>{reply=resolve;}));
  const pending=handler('handleRematchSameDecks',ports)();await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));
  if(invalidation==='account')expire();else (ports.openingRef as {current:unknown}).current=null;
  vi.clearAllMocks();reply({kind:'ready',participants});await pending;
  expect(journal.getSnapshot().record?.id).toBe(game.id);expect(ports.saveJournal).not.toHaveBeenCalled();
  expect(ports.syncJournal).not.toHaveBeenCalled();expect(ports.showToast).not.toHaveBeenCalled();expect(ports.onEvent).not.toHaveBeenCalled();
 });
}
it('rematch retries a changing selection once and never creates after repeated catalog changes',async()=>{
 const {ports,journal,game}=onlineRematch();let stamp=0;ports.readReferenceStamp=()=>String(stamp++);
 await handler('handleRematchSameDecks',ports)();
 expect(ports.readLiveGameRoundReferences).toHaveBeenCalledTimes(2);expect(journal.getSnapshot().record?.id).toBe(game.id);
 expect(ports.saveJournal).not.toHaveBeenCalled();expect(ports.showToast).toHaveBeenCalledWith('liveGameRematchUnavailable');
});
it('malformed references cannot trigger native offline fallback',async()=>{
 const {ports,journal,game}=onlineRematch();
 vi.mocked(ports.readLiveGameRoundReferences as ReturnType<typeof vi.fn>).mockRejectedValue(new LiveGameReferenceReadError('invalid'));
 await handler('handleRematchSameDecks',ports)();expect(journal.getSnapshot().record?.id).toBe(game.id);
 expect(ports.saveJournal).not.toHaveBeenCalled();expect(ports.showToast).toHaveBeenCalledWith('liveGameRematchUnavailable');
});
it('unavailable transport preserves native offline starts and does not mutate the historical recap',async()=>{
 const {ports,journal,game}=onlineRematch();
 vi.mocked(ports.readLiveGameRoundReferences as ReturnType<typeof vi.fn>).mockRejectedValue(new LiveGameReferenceReadError('unavailable'));
 await handler('handleRematchSameDecks',ports)();expect(journal.getSnapshot().record?.id).not.toBe(game.id);
 expect(journal.getSnapshot().record?.state.players[0].commander).toBe('A');expect(ports.syncJournal).toHaveBeenCalledOnce();
});
it('double tap shares the scoped command and a successful recap close still syncs after persistence',async()=>{
 const {ports}=onlineRematch();let reply!:()=>void;
 vi.mocked(ports.saveJournal as ReturnType<typeof vi.fn>).mockImplementation(()=>new Promise<void>(resolve=>{reply=resolve;}));
 const original=ports.onEvent as (event:unknown)=>void;
 ports.onEvent=vi.fn(event=>{original(event);(ports.openingRef as {current:unknown}).current=null;});
 const run=handler('handleRematchSameDecks',ports);const pending=run();
 await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));await run();reply();await pending;
 expect(ports.saveJournal).toHaveBeenCalledOnce();expect(ports.fetchBusyLiveGameParticipantKeys).toHaveBeenCalledOnce();
 expect(ports.syncJournal).toHaveBeenCalledOnce();
});
it('reselect does nothing after scope expiration',async()=>{
 const {ports,expire}=fixture();expire();await handler('handleRematchReselect',ports)();
 expect(ports.applySeatSetups).not.toHaveBeenCalled();expect(ports.onEvent).not.toHaveBeenCalled();
});

it('start metadata uses the scoped setup projection for registered and guest references outside the limited catalog',()=>{
 const {ports}=fixture();
 ports.setupParticipants=[{key:'user:actor-a',name:'Current member'},{key:'guest:g',name:'Current guest'}];
 ports.participantDecks={'user:actor-a':'deck-a','guest:g':'deck-g'};
 ports.getDeckOptions=(key:string)=>[{id:key==='user:actor-a'?'deck-a':'deck-g',commander:'Current commander',commander_image:null}];
 const resolve=handler('resolveMeta',ports);
 expect(Reflect.apply(resolve,null,['user:actor-a'])).toMatchObject({displayName:'Current member',deckId:'deck-a',isGuest:false,userId:'actor-a'});
 expect(Reflect.apply(resolve,null,['guest:g'])).toMatchObject({displayName:'Current guest',deckId:'deck-g',isGuest:true,guestId:'g'});
 ports.setupParticipants=[];
 expect(Reflect.apply(handler('resolveMeta',ports),null,['user:actor-a'])).toBeNull();
});
