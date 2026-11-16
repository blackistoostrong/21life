import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureReport } from '../fixtures/admin-users';
const mocks = vi.hoisted(() => ({ user: true, admin: true, authError: false, client: true, rpcError: false,
  limited: false, rpc: vi.fn(), data: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.user ? { id: 'admin-user' } : null }, error: mocks.authError ? {} : null }) },
}) }));
vi.mock('@/lib/admin', () => ({ isPlatformAdministrator: async () => mocks.admin }));
vi.mock('@/lib/api-rate-limit', () => ({ enforceUserRateLimit: async () => mocks.limited ? new Response('rate limited', { status: 429, headers: { 'Retry-After': '60' } }) : null }));
vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdminClient: () => mocks.client ? { rpc: mocks.rpc } : null }));
import { GET } from '@/app/api/admin/users/route';

describe('admin user directory boundary', () => {
  beforeEach(() => {
    Object.assign(mocks, { user: true, admin: true, authError: false, client: true, rpcError: false, limited: false, data: fixtureReport() });
    mocks.rpc.mockReset().mockImplementation(() => ({ abortSignal: async () => ({ data: mocks.data,
      error: mocks.rpcError ? { message: 'private server secret' } : null }) }));
  });
  it.each(['anonymous', 'member', 'invalid session'])('rejects %s before reading private data', async type => {
    mocks.user = type !== 'anonymous'; mocks.admin = type !== 'member'; mocks.authError = type === 'invalid session';
    const response = await GET(new Request('https://example.test/api/admin/users'));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['page=-1', 'from=2026-02-30', 'status=admin', 'format=exe', 'format=csv&format=csv', 'source=web&source=app'])('rejects invalid filters %s', async query => {
    const response = await GET(new Request(`https://example.test/api/admin/users?${query}`));
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('uses one aggregate snapshot for applied filters and preserves privacy headers', async () => {
    const response = await GET(new Request('https://example.test/api/admin/users?search=alice&source=app&from=2026-01-01&sort=games'));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_user_directory_v1', expect.objectContaining({
      p_search: 'alice', p_source: 'app', p_from: '2026-01-01', p_sort: 'games', p_page: 1, p_page_size: 25,
    }));
    expect(response.headers.get('vary')).toBe('Cookie');
    expect((await response.json()).summary.registered).toBe(1);
  });
  it('exports all applied results in a single snapshot regardless of the viewed page', async () => {
    mocks.data = { ...fixtureReport(), page: 1, pageSize: 5001 };
    const response = await GET(new Request('https://example.test/api/admin/users?format=csv&page=2&source=app'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_user_directory_v1', expect.objectContaining({ p_page: 1, p_page_size: 5001, p_source: 'app' }));
    expect(await response.text()).toContain("'=HYPERLINK");
  });
  it('rejects an oversized export instead of sending the first page as a complete report', async () => {
    const fixture = fixtureReport();
    mocks.data = { ...fixture, pageSize: 5001, total: 5002, population: 5002,
      summary: { ...fixture.summary, registered: 5002 }, users: Array.from({ length: 5001 }, () => fixture.users[0]) };
    const response = await GET(new Request('https://example.test/api/admin/users?format=csv'));
    expect(response.status).toBe(413);
  });
  it('refuses truncated/malformed results and never echoes database errors', async () => {
    mocks.data = { ...fixtureReport(), users: [] };
    expect((await GET(new Request('https://example.test/api/admin/users'))).status).toBe(503);
    mocks.rpcError = true;
    const response = await GET(new Request('https://example.test/api/admin/users'));
    expect(await response.text()).not.toContain('private server secret');
    mocks.rpcError = false; mocks.client = false;
    expect((await GET(new Request('https://example.test/api/admin/users'))).status).toBe(503);
  });
  it('preserves fail-closed rate limiting and Retry-After', async () => {
    mocks.limited = true;
    const response = await GET(new Request('https://example.test/api/admin/users?format=csv'));
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
