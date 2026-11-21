import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsDashboardFixture } from '../fixtures/analytics-dashboard';
const mocks=vi.hoisted(()=>({ available: true,rpc: vi.fn() }));
vi.mock('@/lib/supabase-admin',()=>({ getSupabaseAdminClient: ()=>mocks.available ? { rpc: mocks.rpc } : null }));
import { fetchGlobalAnalyticsReportForAdmin } from '@/lib/global-analytics-query';

describe('service-only global report loader',()=>{
  beforeEach(()=>{ mocks.available=true; mocks.rpc.mockReset().mockReturnValue({ abortSignal: async()=>({ data: { ...analyticsDashboardFixture(),scope: 'global' },error: null }) }); });
  it('returns the complete report through the service client',async()=>{
    expect((await fetchGlobalAnalyticsReportForAdmin()).complete).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('get_global_analytics_dashboard_v2',expect.any(Object));
  });
  it('does not downgrade to an anonymous client when service configuration is absent',async()=>{
    mocks.available=false; await expect(fetchGlobalAnalyticsReportForAdmin()).rejects.toThrow('Service role');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
