import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGlobalAnalyticsPayload, fetchPersonalAnalyticsDashboard, fetchProfileDeckPerformanceReport } from '@/lib/analytics-dashboard-query';
import { analyticsDashboardFixture } from '../fixtures/analytics-dashboard';

describe('versioned analytics requests', () => {
  afterEach(()=>vi.useRealTimers());
  it('requests only the complete personal endpoint and validates its applied filter snapshot', async () => {
    const data=analyticsDashboardFixture();
    data.period={ since: '2026-01-01T00:00:00+00:00', until: '2026-02-01T00:00:00+00:00', bracket: '3' };
    const abortSignal=vi.fn(async ()=>({ data, error: null }));
    const client={ rpc: vi.fn(()=>({ abortSignal })) };
    const value=await fetchPersonalAnalyticsDashboard(client,'self',{ since: '2026-01-01T00:00:00Z', until: '2026-02-01T00:00:00Z', bracket: '3' });
    expect(value.sample.complete).toBe(true);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('get_personal_analytics_dashboard_v2',{
      p_user_id: 'self', p_since: '2026-01-01T00:00:00Z', p_until: '2026-02-01T00:00:00Z', p_bracket: '3',
    });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it('keeps global service access separate from the personal user argument', async () => {
    const data={ ...analyticsDashboardFixture(), scope: 'global' };
    const client={ rpc: vi.fn(()=>({ abortSignal: async ()=>({ data,error: null }) })) };
    expect((await fetchGlobalAnalyticsPayload(client)).scope).toBe('global');
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('get_global_analytics_dashboard_v2',{ p_since: null, p_until: null, p_bracket: null });
  });
  it('does not read another endpoint or manufacture zeros on backend errors', async () => {
    const client={ rpc: vi.fn(()=>({ abortSignal: async ()=>({ data: null,error: { message: 'private SQL details' } }) })) };
    await expect(fetchPersonalAnalyticsDashboard(client,'self')).rejects.toThrow('ANALYTICS_UNAVAILABLE');
    expect(client.rpc).toHaveBeenCalledOnce();
  });
  it.each(['legacy','partial','foreign scope','wrong filter'])('refuses %s responses without a fallback', async type => {
    const data=type==='legacy' ? [] : { ...analyticsDashboardFixture(),
      ...(type==='partial' ? { complete: false } : type==='foreign scope' ? { scope: 'global' } : { period: { since: null, until: null, bracket: '2' } }) };
    const client={ rpc: vi.fn(()=>({ abortSignal: async ()=>({ data,error: null }) })) };
    await expect(fetchPersonalAnalyticsDashboard(client,'self')).rejects.toThrow('ANALYTICS_CONTRACT_INVALID');
    expect(client.rpc).toHaveBeenCalledOnce();
  });
  it('cancels stalled transport at the deadline', async () => {
    vi.useFakeTimers(); let transport: AbortSignal | undefined;
    const client={ rpc: vi.fn(()=>({ abortSignal: (signal: AbortSignal)=>{ transport=signal; return new Promise<never>(()=>undefined); } })) };
    const operation=fetchPersonalAnalyticsDashboard(client,'self');
    const assertion=expect(operation).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000); await assertion;
    expect(transport?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('honors account/context cancellation before any transport begins', async () => {
    const controller=new AbortController(); controller.abort();
    const abortSignal=vi.fn();
    const client={ rpc: vi.fn(()=>({ abortSignal })) };
    await expect(fetchPersonalAnalyticsDashboard(client,'self',{},controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(abortSignal).not.toHaveBeenCalled();
    await expect(fetchPersonalAnalyticsDashboard(client,'')).rejects.toThrow('ANALYTICS_USER_REQUIRED');
  });
  it('requests the complete profile object without the old raw-row fallback', async () => {
    const client={ rpc: vi.fn(()=>({ abortSignal: async()=>({ data: { schemaVersion: 2, complete: true, asOf: '2026-11-16T00:00:00Z', total: 0, decks: [] }, error: null }) })) };
    expect((await fetchProfileDeckPerformanceReport(client,'self')).total).toBe(0);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('get_profile_deck_performance_v2',{ p_user_id: 'self' });
  });
});
