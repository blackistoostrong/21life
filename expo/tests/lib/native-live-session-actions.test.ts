import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {beforeEach,expect,it,vi} from 'vitest';
import {createLiveGameRound} from '../../../packages/domain/live-game-round';
import {acknowledgeLiveGameOutboxItem,loadLiveGameOutbox,saveLiveGameOutbox,type ArchivedLiveGameOperation} from '@/lib/live-game-offline';

const io=vi.hoisted(()=>({values:new Map<string,string>(),setItem:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:{
 getItem:async(key:string)=>io.values.get(key)??null,
 setItem:io.setItem,removeItem:async(key:string)=>{io.values.delete(key);},
}}));
beforeEach(()=>{io.values.clear();io.setItem.mockReset().mockImplementation(async(key:string,value:string)=>{io.values.set(key,value);});});

const source=readFileSync('hooks/use-native-live-session.ts','utf8');
function action(name:string,ports:Record<string,unknown>){
 const ast=ts.createSourceFile('session.ts',source,ts.ScriptTarget.Latest,true);let expression:ts.Expression|undefined;
 const visit=(node:ts.Node)=>{
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name&&node.initializer)
   expression=ts.isCallExpression(node.initializer)?node.initializer.arguments[0]:node.initializer;
  ts.forEachChild(node,visit);
 };visit(ast);if(!expression)throw Error(`Missing production action ${name}`);
 return new Function(...Object.keys(ports),`${ts.transpile(`const command=${expression.getText(ast)};`,{target:ts.ScriptTarget.ES2022})};return command;`)(...Object.values(ports)) as ()=>Promise<boolean>|void;
}
function archive(id:string):ArchivedLiveGameOperation{
 const record=createLiveGameRound({id,groupId:'group',actorId:'alice',startedAt:'2026-11-26T10:00:00Z',startingLife:40,layoutVariant:'classic',random:()=>0,
  seats:[{participantKey:'user:alice',deckId:'deck',displayName:'Alice',commander:'A',commanderImage:null}]});
 return {id,serverRecord:record,needsCreate:true,mutations:[],finalization:null,cancel:true};
}
function ports(items:ArchivedLiveGameOperation[]=[]){
 const epoch={actorId:'alice',groupId:'group'};
 return {currentUserId:'alice',recoveryOutbox:items,saveLiveGameOutbox,loadLiveGameOutbox,acknowledgeLiveGameOutboxItem,
  isLiveScopeCurrent:vi.fn(()=>true),liveScopeEpoch:epoch,timerEpochRef:{current:epoch},syncTimerRef:{current:100 as number|null},
  clearTimeout:vi.fn(),setTimeout:vi.fn(()=>101),getLiveGameSyncDelay:()=>0,syncJournal:vi.fn(),
  discardRecoveryRef:{current:null as Promise<boolean>|null},setDiscardingRecovery:vi.fn(),
  syncPromiseRef:{current:null as Promise<void>|null},getSupabaseErrorMessage:(_error:unknown,fallback:string)=>fallback,copy:(key:string)=>key,
  setRecoveryOutbox:vi.fn(),setSyncError:vi.fn(),setSyncStatus:vi.fn(),
  journal:{getSnapshot:()=>({closed:false,mutations:[{}],batchStartedAt:0}),markUnavailable:vi.fn()}};
}

it('a late old-actor schedule cannot clear the new actor timer',()=>{
 const p=ports();p.isLiveScopeCurrent.mockReturnValue(false);action('scheduleSync',p)();
 expect(p.clearTimeout).not.toHaveBeenCalled();expect(p.syncTimerRef.current).toBe(100);
});
it('an old cancellation cannot clear a timer owned by a newer epoch',()=>{
 const p=ports();p.timerEpochRef.current={actorId:'bob',groupId:'group'};action('cancelScheduledSync',p)();
 expect(p.clearTimeout).not.toHaveBeenCalled();expect(p.syncTimerRef.current).toBe(100);
});
it('current epoch cleanup still clears its own timer after scope deactivation',()=>{
 const p=ports();p.isLiveScopeCurrent.mockReturnValue(false);action('cancelScheduledSync',p)();
 expect(p.clearTimeout).toHaveBeenCalledWith(100);expect(p.syncTimerRef.current).toBeNull();
});
it.each(['new','revised'])('discard preserves %s archives outside the confirmed snapshot',async kind=>{
 const original=archive('first');const later=kind==='new'?archive('second'):{...original,cancel:false};
 await saveLiveGameOutbox(kind==='new'?[original,later]:[later],'alice');const p=ports([original]);
 await action('discardRecovery',p)();
 expect(await loadLiveGameOutbox('alice')).toEqual([later]);expect(p.setRecoveryOutbox).toHaveBeenCalledWith([later]);
});
it('discard waits for durable acknowledgement before clearing the visible recovery count',async()=>{
 const item=archive('first');await saveLiveGameOutbox([item],'alice');const p=ports([item]);
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
 io.setItem.mockImplementationOnce(async(key:string,value:string)=>{await gate;io.values.set(key,value);});
 const pending=action('discardRecovery',p)();
 try{expect(p.setRecoveryOutbox).not.toHaveBeenCalled();}finally{release();await pending;await loadLiveGameOutbox('alice');}
});

it('storage failure preserves recovery data, shows failure and releases the command',async()=>{
 const item=archive('first');await saveLiveGameOutbox([item],'alice');const p=ports([item]);
 io.setItem.mockRejectedValueOnce(Error('Storage unavailable'));
 expect(await action('discardRecovery',p)()).toBe(false);
 expect(await loadLiveGameOutbox('alice')).toEqual([item]);expect(p.setRecoveryOutbox).not.toHaveBeenCalled();
 expect(p.journal.markUnavailable).toHaveBeenCalledOnce();expect(p.setSyncStatus).toHaveBeenCalledWith('error');
 expect(p.setSyncError).toHaveBeenCalledWith('liveGameDiscardFailed');expect(p.discardRecoveryRef.current).toBeNull();
 expect(p.setDiscardingRecovery).toHaveBeenLastCalledWith(false);
});

it('double discard shares one in-flight command and one durable removal',async()=>{
 const item=archive('first');await saveLiveGameOutbox([item],'alice');const p=ports([item]);io.setItem.mockClear();
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
 io.setItem.mockImplementationOnce(async(key:string,value:string)=>{await gate;io.values.set(key,value);});
 const discard=action('discardRecovery',p);const first=discard();const second=discard();
 expect(second).toBe(first);release();expect(await first).toBe(true);expect(io.setItem).toHaveBeenCalledOnce();
 expect(p.setRecoveryOutbox).toHaveBeenCalledWith([]);
});

it('an accepted old-account removal cannot publish into the new opening',async()=>{
 const item=archive('first');await saveLiveGameOutbox([item],'alice');const p=ports([item]);
 let release!:()=>void;let entered!:()=>void;const gate=new Promise<void>(done=>{release=done;});const started=new Promise<void>(done=>{entered=done;});
 io.setItem.mockImplementationOnce(async(key:string,value:string)=>{entered();await gate;io.values.set(key,value);});
 const pending=action('discardRecovery',p)();await started;p.isLiveScopeCurrent.mockReturnValue(false);
 const next=Promise.resolve(true);p.discardRecoveryRef.current=next;vi.clearAllMocks();release();
 expect(await pending).toBe(false);expect(await loadLiveGameOutbox('alice')).toEqual([]);
 expect(p.setRecoveryOutbox).not.toHaveBeenCalled();expect(p.setDiscardingRecovery).not.toHaveBeenCalled();
 expect(p.discardRecoveryRef.current).toBe(next);
});

it('discard cannot race an already dispatched archive replay',async()=>{
 const item=archive('first');await saveLiveGameOutbox([item],'alice');const p=ports([item]);
 p.syncPromiseRef.current=Promise.resolve();io.setItem.mockClear();
 expect(await action('discardRecovery',p)()).toBe(false);expect(io.setItem).not.toHaveBeenCalled();
 expect(p.setRecoveryOutbox).not.toHaveBeenCalled();
});

it('network sync cannot dispatch archive replay during a pending discard',async()=>{
 const p={...ports(),bootstrappingRef:{current:false}};p.discardRecoveryRef.current=Promise.resolve(true);
 await action('syncJournal',p)();expect(p.clearTimeout).not.toHaveBeenCalled();
});
