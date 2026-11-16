import { afterEach,describe,expect,it,vi } from 'vitest';
import { fetchCompleteProfileCatalog,fetchProfileCatalogPage,parseProfileCatalogPage } from '@/lib/profile-catalog-pages';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const revision='a'.repeat(32);
const deck=(n:number)=>({id:id(n),user_id:'self',group_id:null,name:'Deck '+n,commander:'Commander'});
const page=(decks:ReturnType<typeof deck>[],total=decks.length,next:string|null=null)=>({schemaVersion:2,scope:'personal',userId:'self',revision,total,decks,next});

describe('complete profile catalog traversal',()=>{
  afterEach(()=>vi.useRealTimers());
  it.each([0,1,250,251,1006])('returns exactly %i catalog identities through bounded keyset pages',async total=>{
    const all=Array.from({length:total},(_,n)=>deck(n+1));
    const load=vi.fn(async(after:string|null,expected:string|null)=>{
      const offset=after ? all.findIndex(item=>item.id===after)+1 : 0;
      const chunk=all.slice(offset,offset+250);
      return parseProfileCatalogPage(page(chunk,total,chunk.length===250?chunk.at(-1)!.id:null),'self',after,expected);
    });
    expect(await fetchCompleteProfileCatalog(load)).toEqual(all);
    expect(load).toHaveBeenCalledTimes(Math.floor(total/250)+1);
    if(total>250)expect(load.mock.calls[1]).toEqual([id(250),revision,expect.any(AbortSignal)]);
  });
  it.each(['scope','user','revision','order','owner','group','cursor','total','page size'])('rejects invalid %s pages',type=>{
    const value=page([deck(1),deck(2)]);
    if(type==='scope')value.scope='global';
    if(type==='user')value.userId='other';
    if(type==='revision')value.revision='b'.repeat(32);
    if(type==='order')value.decks.reverse();
    if(type==='owner')value.decks[0].user_id='other';
    if(type==='group')Reflect.set(value.decks[0],'group_id','group');
    if(type==='cursor')value.next=id(2);
    if(type==='total')value.total=10001;
    if(type==='page size')value.decks=Array.from({length:251},(_,n)=>deck(n+1));
    expect(()=>parseProfileCatalogPage(value,'self',null,revision)).toThrow('PROFILE_CATALOG_INVALID');
  });
  it('fails rather than returning an incomplete terminal page',async()=>{
    await expect(fetchCompleteProfileCatalog(async()=>parseProfileCatalogPage(page([deck(1)],2),'self',null,null))).rejects.toThrow('PROFILE_CATALOG_INVALID');
  });
  it('never emits partial pages when the database detects a concurrent edit',async()=>{
    const initial=page(Array.from({length:250},(_,n)=>deck(n+1)),251,id(250));
    const rpc=vi.fn().mockReturnValueOnce({abortSignal:async()=>({data:initial,error:null})})
      .mockReturnValueOnce({abortSignal:async()=>({data:null,error:{code:'40001'}})});
    await expect(fetchCompleteProfileCatalog((after,expected,signal)=>fetchProfileCatalogPage({rpc},'self',after,expected,signal))).rejects.toThrow('PROFILE_CATALOG_UNAVAILABLE');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('bounds memory and checks cancellation even if a transport resolves late',async()=>{
    const huge={...deck(1),name:'a'.repeat(8*1024*1024)};
    await expect(fetchCompleteProfileCatalog(async()=>parseProfileCatalogPage(page([huge]),'self',null,null))).rejects.toThrow('PROFILE_CATALOG_TOO_LARGE');
    const controller=new AbortController();controller.abort();const load=vi.fn();
    await expect(fetchCompleteProfileCatalog(load,controller.signal)).rejects.toThrow('PROFILE_CATALOG_CANCELLED');expect(load).not.toHaveBeenCalled();
    const nextController=new AbortController();
    await expect(fetchCompleteProfileCatalog(async()=>{nextController.abort();return parseProfileCatalogPage(page([]),'self',null,null);},nextController.signal)).rejects.toThrow('PROFILE_CATALOG_CANCELLED');
  });
  it('uses the separate global service endpoint and validates global rows',async()=>{
    const data={...page([deck(1)]),scope:'global',userId:null};
    const rpc=vi.fn(()=>({abortSignal:async()=>({data,error:null})}));
    expect((await fetchProfileCatalogPage({rpc},null,null,null)).decks).toHaveLength(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_global_profile_catalog_page_v2',{p_after:null,p_revision:null,p_limit:250});
  });
  it('enforces a deadline for the complete traversal',async()=>{
    vi.useFakeTimers();let signal:AbortSignal|undefined;
    const operation=fetchCompleteProfileCatalog(async(_after,_revision,requestSignal)=>{
      signal=requestSignal;await new Promise<void>(resolve=>requestSignal.addEventListener('abort',()=>resolve(),{once:true}));
      return parseProfileCatalogPage(page([]),'self',null,null);
    });
    const assertion=expect(operation).rejects.toThrow('PROFILE_CATALOG_CANCELLED');
    await vi.advanceTimersByTimeAsync(30000);await assertion;expect(signal?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
  });
});
