import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

const mocks=vi.hoisted(()=>({ user: true, admin: true, authThrows: false, queryThrows: false, limited: false, fetch: vi.fn() }));
vi.mock('@/lib/supabase/server',()=>({ createServerSupabaseClient: async()=>({ auth: { getUser: async()=>{
  if (mocks.authThrows) throw new Error('private auth detail');
  return { data: { user: mocks.user ? { id: 'admin' } : null },error: null };
} } }) }));
vi.mock('@/lib/admin',()=>({ isPlatformAdministrator: async()=>mocks.admin }));
vi.mock('@/lib/global-profile-query',()=>({ fetchGlobalProfileMetrics: mocks.fetch }));
vi.mock('@/lib/api-rate-limit',()=>({ enforceUserRateLimit: async()=>mocks.limited ? new Response('limited',{ status: 429,headers: { 'Retry-After': '60' } }) : null }));
import { GET } from '@/app/api/admin/profile-analytics/route';

describe('global analytics service boundary',()=>{
  beforeEach(()=>{
    Object.assign(mocks,{ user: true,admin: true,authThrows: false,queryThrows: false,limited: false });
    mocks.fetch.mockReset().mockResolvedValue({ ...profileCatalogFixture(),scope: 'global',userId:null });
  });
  it.each(['anonymous','member'])('denies %s before privileged access',async type=>{
    mocks.user=type!=='anonymous'; mocks.admin=type!=='member';
    const response=await GET(new Request('https://example.test/api/admin/profile-analytics'));
    expect(response.status).toBe(403); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('returns complete profile metrics with private headers',async()=>{
    const request=new Request('https://example.test/api/admin/profile-analytics');
    const response=await GET(request); const body=await response.json();
    expect(response.status).toBe(200); expect(body.decks[0].games_played).toBe(3);
    expect(body).toMatchObject({ schemaVersion: 2,complete: true,scope: 'global' });
    expect(mocks.fetch).toHaveBeenCalledWith(request.signal);
    expect(response.headers.get('vary')).toBe('Cookie');
  });
  it('fails closed on unavailable auth and does not echo details',async()=>{
    mocks.authThrows=true;
    const response=await GET(new Request('https://example.test/api/admin/profile-analytics'));
    expect(response.status).toBe(503); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('private auth detail');
  });
  it('does not present zeros or leak details after a backend failure',async()=>{
    mocks.fetch.mockRejectedValue(new Error('private SQL detail'));
    const response=await GET(new Request('https://example.test/api/admin/profile-analytics'));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private SQL detail');
  });
  it('preserves private headers and retry guidance when rate limiting',async()=>{
    mocks.limited=true;
    const response=await GET(new Request('https://example.test/api/admin/profile-analytics'));
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
