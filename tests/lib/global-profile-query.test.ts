import {beforeEach,describe,expect,it,vi} from 'vitest';
import {profileCatalogFixture} from '../fixtures/profile-catalog';
const mocks=vi.hoisted(()=>({available:true,rpc:vi.fn()}));
vi.mock('@/lib/supabase-admin',()=>({getSupabaseAdminClient:()=>mocks.available?{rpc:mocks.rpc}:null}));
import {fetchGlobalProfileMetrics,fetchGlobalProfileCatalogPage} from '@/lib/global-profile-query';
describe('global profile service isolation',()=>{
  beforeEach(()=>{mocks.available=true;mocks.rpc.mockReset();});
  it('requires service configuration for both reports and catalog pages',async()=>{
    mocks.available=false;
    await expect(fetchGlobalProfileMetrics()).rejects.toThrow('ANALYTICS_UNAVAILABLE');
    await expect(fetchGlobalProfileCatalogPage(null,null)).rejects.toThrow('PROFILE_CATALOG_UNAVAILABLE');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes the request signal only through the service client',async()=>{
    mocks.rpc.mockReturnValueOnce({abortSignal:async()=>({data:{...profileCatalogFixture(),scope:'global',userId:null},error:null})});
    expect((await fetchGlobalProfileMetrics()).total).toBe(1);
    mocks.rpc.mockReturnValueOnce({abortSignal:async()=>({data:{schemaVersion:2,scope:'global',userId:null,revision:'a'.repeat(32),total:0,decks:[],next:null},error:null})});
    expect((await fetchGlobalProfileCatalogPage(null,null)).decks).toEqual([]);
    expect(mocks.rpc.mock.calls.map(call=>call[0])).toEqual(['get_global_profile_deck_performance_v2','get_global_profile_catalog_page_v2']);
  });
});
