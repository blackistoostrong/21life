import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPersonalAnalyticsDashboard, fetchProfileDeckPerformanceReport } from '@/lib/analytics-dashboard-query';
import { analyticsDashboardFixture } from '../../../tests/fixtures/analytics-dashboard';

describe('native complete analytics adapter',()=>{
  afterEach(()=>vi.useRealTimers());
  it('uses the same versioned endpoint, sample and draw denominator as web',async()=>{
    const client={ rpc: vi.fn(()=>({ abortSignal: async()=>({ data: analyticsDashboardFixture(),error: null }) })) };
    const result=await fetchPersonalAnalyticsDashboard(client,'native-user');
    expect(result).toMatchObject({ gamesPlayed: 3,wins: 1,draws: 1,winRate: 50,sample: { complete: true } });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('get_personal_analytics_dashboard_v2',{ p_user_id: 'native-user',p_since: null,p_until: null,p_bracket: null });
  });
  it('does not fall back to raw rows on unavailable or incomplete backends',async()=>{
    let error: unknown={ message: 'private SQL' };
    const client={ rpc: vi.fn(()=>({ abortSignal: async()=>({ data: [],error }) })) };
    await expect(fetchPersonalAnalyticsDashboard(client,'native-user')).rejects.toThrow('ANALYTICS_UNAVAILABLE');
    expect(client.rpc).toHaveBeenCalledOnce();
    error=null;
    await expect(fetchPersonalAnalyticsDashboard(client,'native-user')).rejects.toThrow('ANALYTICS_CONTRACT_INVALID');
  });
  it('honors cancellation and the deadline on mobile transport',async()=>{
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const client={ rpc: ()=>({ abortSignal: (value: AbortSignal)=>{ signal=value; return new Promise<never>(()=>undefined); } }) };
    const controller=new AbortController();
    const request=fetchPersonalAnalyticsDashboard(client,'native-user',{},controller.signal);
    const assertion=expect(request).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await assertion;
    expect(signal?.aborted).toBe(true);
    const timeout=fetchPersonalAnalyticsDashboard(client,'native-user');
    const timeoutAssertion=expect(timeout).rejects.toThrow('timed out'); await vi.advanceTimersByTimeAsync(15000); await timeoutAssertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('validates the profile wrapper instead of accepting a truncated array',async()=>{
    const client={ rpc: vi.fn(()=>({ abortSignal: async()=>({ data: { schemaVersion: 2,complete: true,asOf: '2026-11-16T00:00:00Z',total: 0,decks: [] },error: null }) })) };
    expect((await fetchProfileDeckPerformanceReport(client,'native-user')).total).toBe(0);
    expect(client.rpc).toHaveBeenCalledWith('get_profile_deck_performance_v2',{ p_user_id: 'native-user' });
  });
});
