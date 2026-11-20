import {beforeEach,describe,expect,it,vi} from 'vitest';
const hooks=vi.hoisted(()=>({values:[] as unknown[],cursor:0,effects:[] as Array<()=>void>}));
const transport=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('react',async original=>{
  const memo=(compute:()=>unknown,deps:unknown[])=>{
    const i=hooks.cursor++,previous=hooks.values[i] as {deps:unknown[];value:unknown}|undefined;
    if(!previous || deps.some((value,index)=>!Object.is(value,previous.deps[index])))hooks.values[i]={deps,value:compute()};
    return (hooks.values[i] as {value:unknown}).value;
  };
  return {...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]=initial;
    return [hooks.values[i],(next:unknown)=>{hooks.values[i]=typeof next==='function'?next(hooks.values[i]):next;}];},
  useRef:(initial:unknown)=>{const i=hooks.cursor++;if(!(i in hooks.values))hooks.values[i]={current:initial};return hooks.values[i];},
  useMemo:memo,useCallback:(fn:unknown,deps:unknown[])=>memo(()=>fn,deps),
  useEffect:(setup:()=>void|(()=>void),deps:unknown[])=>{
    const i=hooks.cursor++,previous=hooks.values[i] as {deps:unknown[];cleanup?:()=>void}|undefined;
    if(!previous || deps.some((value,index)=>!Object.is(value,previous.deps[index])))hooks.effects.push(()=>{
      previous?.cleanup?.();hooks.values[i]={deps,cleanup:setup()};
    });
  },
  useLayoutEffect:(setup:()=>void|(()=>void),deps:unknown[])=>{
    const i=hooks.cursor++,previous=hooks.values[i] as {deps:unknown[];cleanup?:()=>void}|undefined;
    if(!previous || deps.some((value,index)=>!Object.is(value,previous.deps[index])))hooks.effects.push(()=>{
      previous?.cleanup?.();hooks.values[i]={deps,cleanup:setup()};
    });
  },
};});
vi.mock('expo-crypto',()=>({randomUUID:()=>crypto.randomUUID()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:transport.rpc}}));
vi.mock('@/hooks/use-arena-history',()=>({useArenaHistory:()=>history}));
vi.mock('@/lib/arena-queries',()=>({fetchArenaGroup:vi.fn(),fetchArenaGuests:vi.fn(),fetchArenaMemberDecks:vi.fn()}));
vi.mock('@/lib/arena-cache',()=>({loadArenaCache:vi.fn(),saveArenaCache:vi.fn(),clearArenaCache:vi.fn()}));
vi.mock('@/lib/arena-catalog-realtime',()=>({subscribeToArenaCatalog:vi.fn()}));
vi.mock('@/lib/arena-deck-images',()=>({refreshMissingImportedDeckImages:async()=>undefined}));
vi.mock('@/lib/deck-image-cache',()=>({prefetchCommanderNames:vi.fn(),prefetchDeckImageUrls:vi.fn()}));
vi.mock('@/lib/guest-arena',()=>({addDeckToGuest:vi.fn(),createGuestWithDeck:vi.fn()}));
vi.mock('@/lib/api',()=>({apiPost:vi.fn()}));
import {useArena} from '@/hooks/use-arena';
import {useArenaMatchWrite} from '@/hooks/use-arena-match-write';
import {useArenaMatchFormCommand} from '@/hooks/use-arena-match-form-command';
import type {ArenaMatchWriteInput} from '../../../packages/domain/arena-match-write';
import {fetchArenaGroup,fetchArenaGuests,fetchArenaMemberDecks} from '@/lib/arena-queries';
import {loadArenaCache,saveArenaCache,clearArenaCache} from '@/lib/arena-cache';
import {subscribeToArenaCatalog} from '@/lib/arena-catalog-realtime';
const history={matches:[],seed:vi.fn(),reload:vi.fn(),loadMore:vi.fn(),hasMore:false,loadingMore:false,total:null,loading:false,error:null,cached:false};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function RenderCatalog(group='group-a',user='user-a',flush=true){
  hooks.cursor=0;hooks.effects=[];const result=useArena(group,user);
  if(flush)hooks.effects.splice(0).forEach(effect=>effect());return result;
}
const group=(id:string):NonNullable<Awaited<ReturnType<typeof fetchArenaGroup>>>=>({id,name:id,description:null,invite_code:'CODE',created_by:'user',created_at:'2026-01-01T00:00:00Z',profiles:{id:'user',username:'user',display_name:null},group_members:[]});
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function RenderWrite(group='group-a',user='user-a') {
  hooks.cursor=0;hooks.effects=[];const result=useArenaMatchWrite(group,user);
  hooks.effects.splice(0).forEach(effect=>effect());return result;
}
function RenderForm(key='account-a:group-a',opening:unknown=true) {
  hooks.cursor=0;hooks.effects=[];const result=useArenaMatchFormCommand(key,opening);
  hooks.effects.splice(0).forEach(effect=>effect());return result;
}
const matchInput:ArenaMatchWriteInput={mode:'create',isDraw:true,winnerKey:null,notes:'',playedAt:'2026-11-20T12:00:00Z',winCondition:null,
  players:[{key:'user:alice'},{key:'guest:bob'}]};
beforeEach(()=>{
  hooks.values=[];hooks.cursor=0;hooks.effects=[];
  vi.mocked(loadArenaCache).mockResolvedValue(null);vi.mocked(saveArenaCache).mockResolvedValue();vi.mocked(clearArenaCache).mockResolvedValue();
  vi.mocked(fetchArenaGuests).mockResolvedValue([]);vi.mocked(fetchArenaMemberDecks).mockResolvedValue([]);history.reload.mockResolvedValue([]);
  vi.mocked(subscribeToArenaCatalog).mockReturnValue(vi.fn());
});

describe('native atomic match command ownership',()=>{
  it('keeps the same create UUID after an uncertain reply and gives a successful new match a new UUID',async()=>{
    let first=true;
    transport.rpc.mockImplementation((_name,args)=>({abortSignal:async()=>{
      if(first){first=false;return {data:null,error:{code:'503'}};}
      return {data:args.p_match_id,error:null};
    }}));
    const write=RenderWrite();
    await expect(write(matchInput)).rejects.toEqual({code:'503'});
    await RenderWrite()(matchInput);
    expect(transport.rpc.mock.calls[0][1].p_match_id).toBe(transport.rpc.mock.calls[1][1].p_match_id);
    await RenderWrite()(matchInput);
    expect(transport.rpc.mock.calls[2][1].p_match_id).not.toBe(transport.rpc.mock.calls[1][1].p_match_id);
    expect(transport.rpc.mock.calls[1][1]).toMatchObject({p_actor_id:'user-a',p_group_id:'group-a',p_create:true});
  });
  it('blocks duplicate writes synchronously and aborts their SDK request on context change',async()=>{
    let signal!:AbortSignal;
    transport.rpc.mockReturnValue({abortSignal:(next:AbortSignal)=>{signal=next;return new Promise(()=>{});}});
    const write=RenderWrite();const result=expect(write(matchInput)).rejects.toThrow('Operation aborted');
    await expect(write(matchInput)).rejects.toThrow('MATCH_SAVE_PENDING');
    expect(transport.rpc).toHaveBeenCalledOnce();
    RenderWrite('group-b','user-b');await result;expect(signal.aborted).toBe(true);
    RenderWrite();await expect(write(matchInput)).rejects.toThrow('Operation aborted');
    expect(transport.rpc).toHaveBeenCalledOnce();
  });
  it('propagates form cancellation and rejects already cancelled commands before I/O',async()=>{
    const parent=new AbortController();let signal!:AbortSignal;
    transport.rpc.mockReturnValue({abortSignal:(next:AbortSignal)=>{signal=next;return new Promise(()=>{});}});
    const write=RenderWrite();const result=expect(write(matchInput,undefined,parent.signal)).rejects.toThrow('Operation aborted');
    parent.abort();await result;expect(signal.aborted).toBe(true);
    transport.rpc.mockClear();await expect(write(matchInput,undefined,parent.signal)).rejects.toThrow('Operation aborted');
    expect(transport.rpc).not.toHaveBeenCalled();
  });
});

describe('native manual match form feedback ownership',()=>{
  it('blocks a double submit and permits retry after current failure',async()=>{
    const waiting=deferred<void>(),save=vi.fn(()=>waiting.promise),success=vi.fn(),failure=vi.fn();
    const form=RenderForm();const first=form.run(save,success,failure);
    await form.run(save,success,failure);expect(save).toHaveBeenCalledOnce();expect(RenderForm().saving).toBe(true);
    waiting.resolve();await first;expect(success).toHaveBeenCalledOnce();expect(RenderForm().saving).toBe(false);
    await RenderForm().run(async()=>{throw new Error('retryable');},success,failure);
    expect(failure).toHaveBeenCalledOnce();expect(RenderForm().saving).toBe(false);
    await RenderForm().run(async()=>undefined,success,failure);expect(success).toHaveBeenCalledTimes(2);
  });
  it.each(['close','account','unmount'] as const)('aborts and drops late feedback after %s',async departure=>{
    const waiting=deferred<void>(),success=vi.fn(),failure=vi.fn();let signal!:AbortSignal;
    const result=RenderForm().run(next=>{signal=next;return waiting.promise;},success,failure);
    if(departure==='unmount')for(const value of hooks.values)(value as {cleanup?:()=>void})?.cleanup?.();
    else if(departure==='close')RenderForm('account-a:group-a',false);
    else RenderForm('account-b:group-a');
    expect(signal.aborted).toBe(true);
    if(departure!=='unmount')RenderForm();
    waiting.resolve();await result;
    expect(success).not.toHaveBeenCalled();expect(failure).not.toHaveBeenCalled();
    if(departure!=='unmount')expect(RenderForm().saving).toBe(false);
  });
});
describe('native catalog context ownership',()=>{
  it('keeps the new group when an old group request resolves late',async()=>{
    const a=deferred<ReturnType<typeof group>>(),b=deferred<ReturnType<typeof group>>();
    vi.mocked(fetchArenaGroup).mockImplementation((_client,id)=>id==='group-a'?a.promise:b.promise);
    RenderCatalog();await settle();RenderCatalog('group-b','user-b');await settle();
    b.resolve(group('group-b'));await settle();expect(RenderCatalog('group-b','user-b').group?.id).toBe('group-b');
    a.resolve(group('group-a'));await settle();expect(RenderCatalog('group-b','user-b').group?.id).toBe('group-b');
  });
  it('masks a previously loaded catalog synchronously on account change',async()=>{
    vi.mocked(fetchArenaGroup).mockResolvedValue(group('group-a'));RenderCatalog();await settle();expect(RenderCatalog().group?.id).toBe('group-a');
    const next=RenderCatalog('group-b','user-b',false);expect(next.group).toBeNull();expect(next.members).toEqual([]);expect(next.decks).toEqual([]);expect(next.guests).toEqual([]);
  });
  it('finishes loading with an explicit retryable error when metadata fails',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>undefined);vi.mocked(fetchArenaGroup).mockRejectedValue(new Error('private detail'));
    RenderCatalog();await settle();expect(RenderCatalog()).toMatchObject({loading:false,group:null,arenaError:'ARENA_READ_UNAVAILABLE'});
  });
});
