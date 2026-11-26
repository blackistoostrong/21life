import {randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {createLiveGamePlayer,type LiveGameRecord} from '@/lib/live-game';
import {createNativeLiveSessionJournal} from '@/lib/native-live-session-journal';
import {loadLiveGameOfflineSession,clearLiveGameOfflineSessionIfMatches} from '@/lib/live-game-offline';

const {values,multiSet,getItem}=vi.hoisted(()=>{
  const values=new Map<string,string>();
  return {values,getItem:vi.fn(async(key:string)=>values.get(key)??null),
    multiSet:vi.fn(async(entries:[string,string][])=>{entries.forEach(([key,value])=>values.set(key,value));})};
});
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem,multiSet,
  setItem:vi.fn(async(key:string,value:string)=>{values.set(key,value);}),
  removeItem:vi.fn(async(key:string)=>{values.delete(key);}),
}}));

beforeEach(()=>{values.clear();vi.clearAllMocks();});

// The pre-extraction RED executed the page callback; the screen now composes this actual owner.
function fixture(){
  const record:LiveGameRecord={id:'writer-game',group_id:'writer-group',created_by:'writer',status:'active',starting_life:40,
    state:{version:0,events:[],players:[createLiveGamePlayer({slot:0,participantKey:'user:writer',deckId:'deck',displayName:'Writer',
      commander:'Commander',commanderImage:null,startingLife:40,allParticipantKeys:['user:writer']})]},
    match_id:null,started_at:'2026-11-26T00:00:00Z',ended_at:null,created_at:'2026-11-26T00:00:00Z',updated_at:'2026-11-26T00:00:00Z'};
  let active=true;
  const journal=createNativeLiveSessionJournal('writer-group','writer',{isCurrent:()=>active,randomUUID});
  journal.activate();journal.restore({record,serverRecord:record,mutations:[],needsCreate:false,
    pendingFinalization:null,pendingCancel:false,history:{undo:[],redo:[]}});
  const changed=vi.fn();journal.view.subscribe(changed);
  return {journal,changed,save:journal.persist,expire:()=>{active=false;journal.deactivate();}};
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
  const {save,journal,expire}=fixture();const held=holdFirstWrite();
  const first=save();await held.started;
  const second=journal.enqueue({type:'adjust',targetKey:'user:writer',amount:1,mode:'life'})!;expire();
  const remount=loadLiveGameOfflineSession('writer-group','writer');
  held.release();const restored=await remount;await Promise.all([first,second]);
  expect(restored?.record.state.version).toBe(1);
});

it('an accepted old snapshot cannot resurrect a journal after a later matching clear',async()=>{
  const {save,journal,expire}=fixture();const held=holdFirstWrite();
  const first=save();await held.started;
  const second=journal.enqueue({type:'adjust',targetKey:'user:writer',amount:1,mode:'life'})!;expire();
  const cleared=clearLiveGameOfflineSessionIfMatches('writer-group','writer-game','writer');
  held.release();await Promise.all([first,second,cleared]);
  expect(await loadLiveGameOfflineSession('writer-group','writer')).toBeNull();
});

it.each(['expired','closed'] as const)('rejects new writes from an %s journal opening',async state=>{
  const {save,journal,changed,expire}=fixture();
  let release:(()=>void)|undefined;let closing:Promise<boolean>|undefined;
  if(state==='expired')expire();else{
    const held=holdFirstWrite();release=held.release;closing=journal.archive(null,true);await held.started;
    vi.clearAllMocks();
  }
  try{await save();expect(multiSet).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();}
  finally{release?.();await closing;}
});
