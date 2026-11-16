'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchPersonalAnalyticsDashboard } from '@/lib/analytics-dashboard-query';
import { buildAnalyticsDashboard } from '@/packages/domain/analytics-dashboard';
import { parseAnalyticsDashboard } from '@/packages/domain/analytics-dashboard-contract';

type Analytics = ReturnType<typeof buildAnalyticsDashboard>;
type State = { key: string; status: 'loading' | 'error' | 'ready'; data: Analytics | null };

/** Owns one account/scope request and cancels it before the context changes. */
export function useDashboardAnalytics(userId: string | undefined, adminMode: boolean, ready: boolean) {
  const key = ready && userId ? `${userId}:${adminMode ? 'global' : 'personal'}:v2` : null;
  const [state,setState] = useState<State | null>(null);
  const [revision,setRevision] = useState(0);
  useEffect(() => {
    if (!key || !userId) return;
    let active = true;
    const controller = new AbortController();
    const timer = adminMode ? window.setTimeout(()=>controller.abort(),15000) : null;
    setState({ key,status: 'loading',data: null });
    void (async () => {
      try {
        let data: Analytics;
        if (adminMode) {
          const response=await fetch('/api/admin/global-analytics',{ cache: 'no-store',signal: controller.signal });
          if (!response.ok) throw new Error('ANALYTICS_UNAVAILABLE');
          const body: unknown=await response.json();
          if (!body || typeof body !== 'object' || !('report' in body)) throw new Error('ANALYTICS_CONTRACT_INVALID');
          const report=parseAnalyticsDashboard(body.report);
          if (report.scope !== 'global') throw new Error('ANALYTICS_CONTRACT_INVALID');
          data=buildAnalyticsDashboard(report);
        } else data=await fetchPersonalAnalyticsDashboard(supabase,userId,{},controller.signal);
        if (active) setState({ key,status: 'ready',data });
      } catch {
        if (active) setState({ key,status: 'error',data: null });
      } finally { if (timer !== null) window.clearTimeout(timer); }
    })();
    return () => { active=false; controller.abort(); if (timer !== null) window.clearTimeout(timer); };
  },[key,userId,adminMode,revision]);
  const current=state?.key===key ? state : null;
  return { analytics: current?.status === 'ready' ? current.data : null,
    loading: Boolean(userId) && (!ready || (key !== null && (!current || current.status === 'loading'))), error: current?.status === 'error',
    refresh: () => setRevision(value=>value+1) };
}
