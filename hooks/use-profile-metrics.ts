'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchProfileCatalogMetrics } from '@/lib/profile-catalog-query';
import { buildWebProfileMetricMaps } from '@/lib/profile-catalog-metrics';
import { parseProfileCatalogMetrics } from '@/packages/domain/profile-catalog-metrics';

type Catalog = Parameters<typeof buildWebProfileMetricMaps>[1];
type Maps = ReturnType<typeof buildWebProfileMetricMaps>;
type State = { key: string; catalog: Catalog; maps: Maps | null; error: boolean };
const empty: Maps['performance'] = new Map();
/** Account/scope/catalog own one cancellable request. Old-context results are never rendered. */
export function useProfileMetrics(userId: string | undefined, adminMode: boolean, catalog: Catalog) {
  const key = userId ? `${userId}:${adminMode ? 'global' : 'personal'}:profile-v2` : null;
  const [state,setState] = useState<State | null>(null);
  const [revision,setRevision] = useState(0);
  useEffect(()=>{
    if (!key || !userId) return;
    let active=true;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    void (async()=>{
      try {
        let report;
        if (adminMode) {
          const response=await fetch('/api/admin/profile-analytics',{ cache:'no-store',signal:controller.signal });
          if (!response.ok) throw new Error('ANALYTICS_UNAVAILABLE');
          report=parseProfileCatalogMetrics(await response.json());
          if (report.scope !== 'global' || report.userId !== null) throw new Error('ANALYTICS_CONTRACT_INVALID');
        } else report=await fetchProfileCatalogMetrics(supabase,userId,controller.signal);
        const maps=buildWebProfileMetricMaps(report,catalog);
        if (active) setState({ key,catalog,maps,error:false });
      } catch { if (active) setState({ key,catalog,maps:null,error:true }); }
    })();
    return ()=>{ active=false;clearTimeout(timer);controller.abort(); };
  },[key,userId,adminMode,catalog,revision]);
  const current=state?.key===key && state.catalog===catalog ? state : null;
  return { deckPerformance:current?.maps?.performance ?? empty,deckWinRates:current?.maps?.winRates ?? empty,
    metricsLoading: Boolean(key) && !current,metricsError:current?.error ?? false,
    refreshMetrics:()=>setRevision(value=>value+1) };
}
