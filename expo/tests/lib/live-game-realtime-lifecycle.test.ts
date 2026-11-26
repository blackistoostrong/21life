import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';

// Execute the shipped subscription effect and its actual dependency expression.
// This characterizes controller lifetime, not the React Native renderer or SDK.
const source=readFileSync('app/table/[id]/play.tsx','utf8');
const ast=ts.createSourceFile('play.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let effect:ts.CallExpression|undefined;let identity:ts.VariableDeclaration|undefined;
function visit(node:ts.Node){
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'
    &&node.arguments[0]?.getText(ast).includes('subscribeToLiveGame('))effect=node;
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='realtimeRecordId')identity=node;
  ts.forEachChild(node,visit);
}
visit(ast);
if(!effect)throw Error('Missing production Realtime subscription effect');
const code=ts.transpile(`${identity?`const ${identity.getText(ast)};`:''}${effect.getText(ast)};`,{target:ts.ScriptTarget.ES2022});

function fixture(){
  const record={id:'game-a',status:'active'};const snapshot:{record:typeof record|null;needsCreate:boolean;closed:boolean;mutations:unknown[];pendingFinalization:null;pendingCancel:boolean}={record,needsCreate:true,closed:false,mutations:[],pendingFinalization:null,pendingCancel:false};
  let run!:()=>undefined|(()=>void);let dependencies:unknown[]=[];
  let onRecord!:(value:typeof record)=>void;let onStatus!:(status:string)=>void;
  const stop=vi.fn();const closeRemote=vi.fn().mockResolvedValue(true);
  const ports={liveGame:record,journalSnapshot:snapshot,realtimeRecordId:null,
    journal:{getSnapshot:()=>snapshot,closeRemote,markUnavailable:vi.fn(),applyRemote:vi.fn()},
    useEffect:(callback:typeof run,deps:unknown[])=>{run=callback;dependencies=deps;},
    subscribeToLiveGame:vi.fn((_client:unknown,_id:string,change:typeof onRecord,status:typeof onStatus)=>{onRecord=change;onStatus=status;return stop;}),
    supabase:{},isLiveScopeCurrent:vi.fn(()=>true),syncRunningRef:{current:false},copy:(key:string)=>key,
    currentUserId:'alice',groupId:'group',refreshAuthoritativeState:vi.fn().mockResolvedValue(undefined),
    router:{replace:vi.fn()},saveJournal:vi.fn(),showToast:vi.fn(),syncJournal:vi.fn(),
    setSyncStatus:vi.fn(),setCompletedGame:vi.fn(),setCompletedDurationSeconds:vi.fn(),
    setShowEndGame:vi.fn(),setShowRematch:vi.fn(),getGameDurationSeconds:()=>42};
  const render=()=>{
    const {realtimeRecordId:unused,...inputs}=ports;void unused;
    new Function(...Object.keys(inputs),code)(...Object.values(inputs));
    return {run,dependencies};
  };
  return {snapshot,ports,stop,closeRemote,render,status:(value:string)=>onStatus(value),change:(value:typeof record)=>onRecord(value)};
}

it('creation ACK makes the same round eligible for a Realtime subscription',()=>{
  const f=fixture();const before=f.render();before.run();expect(f.ports.subscribeToLiveGame).not.toHaveBeenCalled();
  f.snapshot.needsCreate=false;const after=f.render();
  expect(after.dependencies.some((value,index)=>!Object.is(value,before.dependencies[index]))).toBe(true);
  after.run();expect(f.ports.subscribeToLiveGame).toHaveBeenCalledOnce();
});

it('life mutations do not recreate the channel for an acknowledged round',()=>{
  const f=fixture();f.snapshot.needsCreate=false;const before=f.render();
  f.snapshot.record={...f.snapshot.record!};f.ports.liveGame=f.snapshot.record;
  expect(f.render().dependencies).toEqual(before.dependencies);
});

it('late channel status after teardown cannot change connectivity or start sync',async()=>{
  const f=fixture();f.snapshot.needsCreate=false;const cleanup=f.render().run();cleanup?.();
  expect(f.stop).toHaveBeenCalledOnce();f.status('CLOSED');f.status('SUBSCRIBED');
  await Promise.resolve();await Promise.resolve();
  expect(f.ports.setSyncStatus).not.toHaveBeenCalled();expect(f.ports.refreshAuthoritativeState).not.toHaveBeenCalled();
  expect(f.ports.syncJournal).not.toHaveBeenCalled();
});

it('a terminal storage acknowledgement after teardown cannot publish a recap',async()=>{
  const f=fixture();f.snapshot.needsCreate=false;let resolve!:(value:boolean)=>void;
  f.closeRemote.mockImplementation(()=>new Promise<boolean>(done=>{resolve=done;}));
  const cleanup=f.render().run();f.change({id:'game-a',status:'ended'});cleanup?.();resolve(true);
  await Promise.resolve();await Promise.resolve();
  expect(f.ports.setCompletedGame).not.toHaveBeenCalled();expect(f.ports.showToast).not.toHaveBeenCalled();
});

it('a subscribed refresh that finishes after teardown cannot flush a later round',async()=>{
  const f=fixture();f.snapshot.needsCreate=false;let resolve!:()=>void;
  f.ports.refreshAuthoritativeState.mockImplementation(()=>new Promise<void>(done=>{resolve=done;}));
  const cleanup=f.render().run();f.status('SUBSCRIBED');cleanup?.();resolve();
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  expect(f.ports.syncJournal).not.toHaveBeenCalled();
});

it('a record delivered after teardown cannot enter the journal',()=>{
  const f=fixture();f.snapshot.needsCreate=false;const cleanup=f.render().run();cleanup?.();
  f.change({id:'game-a',status:'active'});
  expect(f.ports.journal.applyRemote).not.toHaveBeenCalled();expect(f.ports.saveJournal).not.toHaveBeenCalled();
});

it('its own successful close may clear the channel before the terminal continuation',async()=>{
  const f=fixture();f.snapshot.needsCreate=false;let resolve!:(value:boolean)=>void;
  f.closeRemote.mockImplementation(()=>new Promise<boolean>(done=>{resolve=done;}));
  const cleanup=f.render().run();const ended={id:'game-a',status:'ended'};f.change(ended);
  f.snapshot.record=null;f.snapshot.closed=true;cleanup?.();resolve(true);
  await Promise.resolve();await Promise.resolve();
  expect(f.ports.setCompletedGame).toHaveBeenCalledWith(ended);
});

it.each(['account','round'])('a terminal ACK cannot publish after the %s owner changes',async change=>{
  const f=fixture();f.snapshot.needsCreate=false;let resolve!:(value:boolean)=>void;
  f.closeRemote.mockImplementation(()=>new Promise<boolean>(done=>{resolve=done;}));
  const cleanup=f.render().run();f.change({id:'game-a',status:'ended'});cleanup?.();
  if(change==='account'){f.snapshot.record=null;f.snapshot.closed=true;f.ports.isLiveScopeCurrent.mockReturnValue(false);}
  else{f.snapshot.record={id:'game-b',status:'active'};f.snapshot.closed=false;}
  resolve(true);await Promise.resolve();await Promise.resolve();
  expect(f.ports.setCompletedGame).not.toHaveBeenCalled();expect(f.ports.showToast).not.toHaveBeenCalled();
});
