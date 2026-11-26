import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {beforeEach,expect,it,vi} from 'vitest';
import {createLiveGamePlayer,type LiveGameRecord} from '@/lib/live-game';
import {queueLiveGameJournalWrite} from '@/lib/live-game-journal-writer';

const {values,multiSet,getItem}=vi.hoisted(()=>{
  const values=new Map<string,string>();
  return {values,getItem:vi.fn(async(key:string)=>values.get(key)??null),
    multiSet:vi.fn(async(entries:[string,string][])=>{entries.forEach(([key,value])=>values.set(key,value));})};
});
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem,multiSet,
  setItem:vi.fn(async(key:string,value:string)=>{values.set(key,value);}),
  removeItem:vi.fn(async(key:string)=>{values.delete(key);}),
}}));
import {saveLiveGameOfflineSession,loadLiveGameOfflineSession,clearLiveGameOfflineSessionIfMatches} from '@/lib/live-game-offline';

beforeEach(()=>{values.clear();vi.clearAllMocks();});

// Run the shipped React callback; replace only platform storage and UI ports.
function saveHandler(ports:Record<string,unknown>){
  const source=readFileSync('app/table/[id]/play.tsx','utf8');
  const ast=ts.createSourceFile('play.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression:ts.Expression|undefined;
  const visit=(node:ts.Node)=>{
    if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='saveJournal'&&node.initializer&&ts.isCallExpression(node.initializer))expression=node.initializer.arguments[0];
    ts.forEachChild(node,visit);
  };visit(ast);
  if(!expression)throw Error('Missing production saveJournal');
  const code=ts.transpile(`const save=${expression.getText(ast)};`,{target:ts.ScriptTarget.ES2022});
  return new Function(...Object.keys(ports),`${code};return save;`)(...Object.values(ports)) as ()=>Promise<void>;
}
function fixture(){
  const record:LiveGameRecord={id:'writer-game',group_id:'writer-group',created_by:'writer',status:'active',starting_life:40,
    state:{version:0,events:[],players:[createLiveGamePlayer({slot:0,participantKey:'user:writer',deckId:'deck',displayName:'Writer',
      commander:'Commander',commanderImage:null,startingLife:40,allParticipantKeys:['user:writer']})]},
    match_id:null,started_at:'2026-11-26T00:00:00Z',ended_at:null,created_at:'2026-11-26T00:00:00Z',updated_at:'2026-11-26T00:00:00Z'};
  let active=true;
  const ports={groupId:'writer-group',currentUserId:'writer',liveGameRef:{current:record},serverRecordRef:{current:record},
    mutationQueueRef:{current:[]},needsCreateRef:{current:false},pendingFinalizationRef:{current:null},pendingCancelRef:{current:false},
    historyRef:{current:{undo:[],redo:[]}},journalWriteRef:{current:Promise.resolve()},sessionClosedRef:{current:false},
    isLiveScopeCurrent:()=>active,publishPendingSyncCount:vi.fn(),setLocalPersistenceAvailable:vi.fn(),
    queueLiveGameJournalWrite,saveLiveGameOfflineSession};
  return {ports,save:saveHandler(ports),expire:()=>{active=false;}};
}
function holdFirstWrite(){
  let release!:()=>void;let entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const started=new Promise<void>(resolve=>{entered=resolve;});
  multiSet.mockImplementationOnce(async entries=>{
    entered();await gate;entries.forEach(([key,value])=>values.set(key,value));
  });
  return {release,started};
}

it('a remount read observes the latest snapshot already accepted by the old opening',async()=>{
  const {save,ports,expire}=fixture();const held=holdFirstWrite();
  const first=save();await held.started;
  ports.liveGameRef.current={...ports.liveGameRef.current,state:{...ports.liveGameRef.current.state,version:1}};
  const second=save();expire();
  const remount=loadLiveGameOfflineSession('writer-group','writer');
  held.release();const restored=await remount;await Promise.all([first,second]);
  expect(restored?.record.state.version).toBe(1);
});

it('an accepted old snapshot cannot resurrect a journal after a later matching clear',async()=>{
  const {save,ports,expire}=fixture();const held=holdFirstWrite();
  const first=save();await held.started;
  ports.liveGameRef.current={...ports.liveGameRef.current,state:{...ports.liveGameRef.current.state,version:1}};
  const second=save();expire();
  const cleared=clearLiveGameOfflineSessionIfMatches('writer-group','writer-game','writer');
  held.release();await Promise.all([first,second,cleared]);
  expect(await loadLiveGameOfflineSession('writer-group','writer')).toBeNull();
});

it.each(['expired','closed'] as const)('rejects new writes from an %s journal opening',async state=>{
  const {save,ports,expire}=fixture();
  if(state==='expired')expire();else ports.sessionClosedRef.current=true;
  await save();expect(multiSet).not.toHaveBeenCalled();expect(ports.publishPendingSyncCount).not.toHaveBeenCalled();
});
