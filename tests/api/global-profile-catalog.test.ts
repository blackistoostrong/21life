import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({ user: true, admin: true, authThrows: false, queryThrows: false, limited: false, fetch: vi.fn() }));
vi.mock('@/lib/supabase/server',()=>({ createServerSupabaseClient: async()=>({ auth: { getUser: async()=>{
  if (mocks.authThrows) throw new Error('private auth detail');
  return { data: { user: mocks.user ? { id: 'admin' } : null },error: null };
} } }) }));
vi.mock('@/lib/admin',()=>({ isPlatformAdministrator: async()=>mocks.admin }));
vi.mock('@/lib/global-profile-query',()=>({ fetchGlobalProfileCatalogPage: mocks.fetch }));
vi.mock('@/lib/api-rate-limit',()=>({ enforceUserRateLimit: async()=>mocks.limited ? new Response('limited',{ status: 429,headers: { 'Retry-After': '60' } }) : null }));
import { GET } from '@/app/api/admin/profile-catalog/route';

describe('global profile catalog boundary',()=>{
  beforeEach(()=>{
    Object.assign(mocks,{ user: true,admin: true,authThrows: false,queryThrows: false,limited: false });
    mocks.fetch.mockReset().mockResolvedValue({ schemaVersion:2,scope:'global',userId:null,decks:[{id:'example'}],total:1 });
  });
  it.each(['anonymous','member'])('denies %s before privileged access',async type=>{
    mocks.user=type!=='anonymous'; mocks.admin=type!=='member';
    const response=await GET(new Request('https://example.test/api/admin/profile-catalog'));
    expect(response.status).toBe(403); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('returns one service-only catalog page with private headers',async()=>{
    const request=new Request('https://example.test/api/admin/profile-catalog');
    const response=await GET(request); const body=await response.json();
    expect(response.status).toBe(200); expect(body.decks[0].id).toBe('example');
    expect(body).toMatchObject({ schemaVersion: 2,scope: 'global' });
    expect(mocks.fetch).toHaveBeenCalledWith(null,null,request.signal);
    expect(response.headers.get('vary')).toBe('Cookie');
  });
  it.each(['?after=bad','?revision=bad','?after=00000000-0000-4000-8000-000000000001'])('rejects malformed cursor %s',async query=>{
    const response=await GET(new Request('https://example.test/api/admin/profile-catalog'+query));
    expect(response.status).toBe(400);expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('fails closed on unavailable auth and does not echo details',async()=>{
    mocks.authThrows=true;
    const response=await GET(new Request('https://example.test/api/admin/profile-catalog'));
    expect(response.status).toBe(503); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('private auth detail');
  });
  it('does not present zeros or leak details after a backend failure',async()=>{
    mocks.fetch.mockRejectedValue(new Error('private SQL detail'));
    const response=await GET(new Request('https://example.test/api/admin/profile-catalog'));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private SQL detail');
  });
  it('preserves private headers and retry guidance when rate limiting',async()=>{
    mocks.limited=true;
    const response=await GET(new Request('https://example.test/api/admin/profile-catalog'));
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
