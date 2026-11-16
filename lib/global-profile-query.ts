import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';
import { fetchProfileCatalogMetrics } from '@/lib/profile-catalog-query';
import { fetchProfileCatalogPage } from '@/lib/profile-catalog-pages';
export async function fetchGlobalProfileMetrics(signal?: AbortSignal) {
  const client=getSupabaseAdminClient();
  if (!client) throw new Error('ANALYTICS_UNAVAILABLE');
  return fetchProfileCatalogMetrics(client,null,signal);
}
export async function fetchGlobalProfileCatalogPage(after:string|null,revision:string|null,signal?:AbortSignal) {
  const client=getSupabaseAdminClient();
  if(!client)throw new Error('PROFILE_CATALOG_UNAVAILABLE');
  return fetchProfileCatalogPage(client,null,after,revision,signal);
}
