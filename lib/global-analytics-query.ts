import 'server-only';
import { fetchGlobalAnalyticsPayload } from '@/lib/analytics-dashboard-query';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';

export async function fetchGlobalAnalyticsReportForAdmin(signal?: AbortSignal) {
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    throw new Error('Service role is not configured.');
  }

  return fetchGlobalAnalyticsPayload(adminClient,{},signal);
}
