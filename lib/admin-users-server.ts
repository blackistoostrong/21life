import 'server-only';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';
import { adminUserReportSchema, type AdminUserFilters } from '@/lib/admin-users-contract';

export const ADMIN_USER_EXPORT_LIMIT = 5000;
export async function fetchAdminUsers(filters: AdminUserFilters, exporting = false) {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error('ADMIN_USERS_UNAVAILABLE');
  const { data, error } = await client.rpc('admin_user_directory_v1', {
    p_search: filters.search, p_status: filters.status, p_activity: filters.activity,
    p_source: filters.source, p_from: filters.from || null, p_to: filters.to || null,
    p_sort: filters.sort, p_page: exporting ? 1 : filters.page,
    p_page_size: exporting ? ADMIN_USER_EXPORT_LIMIT + 1 : filters.pageSize,
  }).abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error('ADMIN_USERS_QUERY_FAILED');
  const parsed = adminUserReportSchema.parse(data);
  const page = exporting ? 1 : filters.page;
  const size = exporting ? ADMIN_USER_EXPORT_LIMIT + 1 : filters.pageSize;
  const expected = Math.max(0, Math.min(size, parsed.total - (page - 1) * size));
  if (parsed.page !== page || parsed.pageSize !== size || parsed.users.length !== expected || parsed.summary.registered !== parsed.total
    || parsed.total > parsed.population) throw new Error('ADMIN_USERS_INVALID_REPORT');
  return parsed;
}
