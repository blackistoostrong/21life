import { parseProfileCatalogMetrics } from '../../packages/domain/profile-catalog-metrics';
import type { AnalyticsDashboardRpcClient } from './analytics-dashboard-query';
import { withLiveGameRequestTimeout } from './live-game-async';

export async function fetchProfileCatalogMetrics(client: AnalyticsDashboardRpcClient, userId: string | null, signal?: AbortSignal) {
  if (userId === '') throw new Error('ANALYTICS_USER_REQUIRED');
  const name = userId === null ? 'get_global_profile_deck_performance_v2' : 'get_profile_deck_performance_v2';
  const { data,error } = await withLiveGameRequestTimeout(client.rpc(name,userId === null ? {} : { p_user_id: userId }),15000,signal);
  if (error) throw new Error('ANALYTICS_UNAVAILABLE');
  const report = parseProfileCatalogMetrics(data);
  if (report.scope !== (userId === null ? 'global' : 'personal') || report.userId !== userId) throw new Error('ANALYTICS_CONTRACT_INVALID');
  return report;
}
