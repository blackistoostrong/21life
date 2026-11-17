import {beforeEach,describe,expect,it,vi} from 'vitest';
const hooks=vi.hoisted(()=>({values:[] as unknown[],cursor:0,effects:[] as Array<()=>void>}));
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
};});
vi.mock('@/lib/supabase',()=>({supabase:{}}));
vi.mock('@/hooks/use-arena-history',()=>({useArenaHistory:()=>history}));
vi.mock('@/lib/arena-queries',()=>({fetchArenaGroup:vi.fn(),fetchArenaGuests:vi.fn(),fetchArenaMemberDecks:vi.fn()}));
vi.mock('@/lib/arena-cache',()=>({loadArenaCache:vi.fn(),saveArenaCache:vi.fn(),clearArenaCache:vi.fn()}));
vi.mock('@/lib/arena-catalog-realtime',()=>({subscribeToArenaCatalog:vi.fn()}));
vi.mock('@/lib/arena-deck-images',()=>({refreshMissingImportedDeckImages:async()=>undefined}));
vi.mock('@/lib/deck-image-cache',()=>({prefetchCommanderNames:vi.fn(),prefetchDeckImageUrls:vi.fn()}));
vi.mock('@/lib/guest-arena',()=>({addDeckToGuest:vi.fn(),createGuestWithDeck:vi.fn()}));
vi.mock('@/lib/api',()=>({apiPost:vi.fn()}));
import {useArena} from '@/hooks/use-arena';
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
beforeEach(()=>{
  hooks.values=[];hooks.cursor=0;hooks.effects=[];
  vi.mocked(loadArenaCache).mockResolvedValue(null);vi.mocked(saveArenaCache).mockResolvedValue();vi.mocked(clearArenaCache).mockResolvedValue();
  vi.mocked(fetchArenaGuests).mockResolvedValue([]);vi.mocked(fetchArenaMemberDecks).mockResolvedValue([]);history.reload.mockResolvedValue([]);
  vi.mocked(subscribeToArenaCatalog).mockReturnValue(vi.fn());
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
