import {describe,expect,it,vi} from 'vitest';
import {fetchCompleteProfileCatalog,fetchProfileCatalogPage} from '@/lib/profile-catalog-pages';
describe('native complete profile catalog',()=>{
  it('loads 1006 identities without a direct table or participant fallback',async()=>{
    const decks=Array.from({length:1006},(_,n)=>({id:`00000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,name:'Deck',commander:'Commander',user_id:'self',group_id:null}));
    const rpc=vi.fn((_name:string,args?:Record<string,unknown>)=>({abortSignal:async()=>{
      const start=args?.p_after?decks.findIndex(deck=>deck.id===args.p_after)+1:0;
      const page=decks.slice(start,start+250);
      return {error:null,data:{schemaVersion:2,scope:'personal',userId:'self',total:decks.length,revision:'a'.repeat(32),decks:page,next:page.length===250?page.at(-1)!.id:null}};
    }}));
    const result=await fetchCompleteProfileCatalog((after,revision,signal)=>fetchProfileCatalogPage({rpc},'self',after,revision,signal));
    expect(result).toEqual(decks);expect(rpc).toHaveBeenCalledTimes(5);
    expect(rpc.mock.calls.every(([name])=>name==='get_profile_catalog_page_v2')).toBe(true);
  });
  it('propagates schema failures and cancellation before rendering a partial catalog',async()=>{
    const rpc=vi.fn(()=>({abortSignal:async()=>({error:null,data:[]})}));
    await expect(fetchProfileCatalogPage({rpc},'self',null,null)).rejects.toThrow('PROFILE_CATALOG_INVALID');
    const controller=new AbortController();controller.abort();const load=vi.fn();
    await expect(fetchCompleteProfileCatalog(load,controller.signal)).rejects.toThrow('PROFILE_CATALOG_CANCELLED');
    expect(load).not.toHaveBeenCalled();
  });
});
