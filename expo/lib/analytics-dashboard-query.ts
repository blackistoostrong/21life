import { buildAnalyticsDashboard } from '../../packages/domain/analytics-dashboard';
import { parseAnalyticsDashboard, parseProfileDeckPerformance } from '../../packages/domain/analytics-dashboard-contract';
import { withLiveGameRequestTimeout } from './live-game-async';

export interface AnalyticsDashboardFilters {
  since?: string | null;
  until?: string | null;
  bracket?: string | null;
}
export interface AnalyticsDashboardRpcClient {
  rpc(name: string, args?: Record<string,unknown>): {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown | null }>;
  };
}

async function fetchDashboardPayload(client: AnalyticsDashboardRpcClient, scope: 'personal' | 'global',
  userId: string | null, filters: AnalyticsDashboardFilters, signal?: AbortSignal) {
  const name = scope === 'personal' ? 'get_personal_analytics_dashboard_v2' : 'get_global_analytics_dashboard_v2';
  const args: Record<string,unknown> = { p_since: filters.since ?? null, p_until: filters.until ?? null, p_bracket: filters.bracket ?? null };
  if (scope === 'personal') args.p_user_id=userId;
  const { data,error } = await withLiveGameRequestTimeout(client.rpc(name,args),15000,signal);
  if (error) throw new Error('ANALYTICS_UNAVAILABLE');
  const payload = parseAnalyticsDashboard(data);
  if (payload.scope !== scope) throw new Error('ANALYTICS_CONTRACT_INVALID');
  const sameTime = (actual: string | null, expected: string | null | undefined) => actual === null
    ? expected == null : expected != null && Date.parse(actual) === Date.parse(expected);
  if (!sameTime(payload.period.since,filters.since) || !sameTime(payload.period.until,filters.until)
    || payload.period.bracket !== (filters.bracket ?? null)) throw new Error('ANALYTICS_CONTRACT_INVALID');
  return payload;
}
export async function fetchPersonalAnalyticsDashboard(client: AnalyticsDashboardRpcClient, userId: string,
  filters: AnalyticsDashboardFilters = {}, signal?: AbortSignal) {
  if (!userId) throw new Error('ANALYTICS_USER_REQUIRED');
  return buildAnalyticsDashboard(await fetchDashboardPayload(client,'personal',userId,filters,signal));
}
/** Server/service caller only; ordinary clients have no execute grant for the RPC. */
export function fetchGlobalAnalyticsPayload(client: AnalyticsDashboardRpcClient, filters: AnalyticsDashboardFilters = {}, signal?: AbortSignal) {
  return fetchDashboardPayload(client,'global',null,filters,signal);
}
export async function fetchProfileDeckPerformanceReport(client: AnalyticsDashboardRpcClient, userId: string, signal?: AbortSignal) {
  if (!userId) throw new Error('ANALYTICS_USER_REQUIRED');
  const { data,error } = await withLiveGameRequestTimeout(client.rpc('get_profile_deck_performance_v2',{ p_user_id: userId }),15000,signal);
  if (error) throw new Error('ANALYTICS_UNAVAILABLE');
  return parseProfileDeckPerformance(data);
}
