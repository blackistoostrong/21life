'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminUserQuery, adminUserReportSchema, DEFAULT_ADMIN_USER_FILTERS, parseAdminUserFilters,
  type AdminUserFilters, type AdminUserReport } from '@/lib/admin-users-contract';

export function useAdminUsers() {
  const [filters, setFilters] = useState<AdminUserFilters>(DEFAULT_ADMIN_USER_FILTERS);
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState<AdminUserReport | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const read = () => {
      try { setFilters(parseAdminUserFilters(new URLSearchParams(window.location.search))); }
      catch { setFilters(DEFAULT_ADMIN_USER_FILTERS); }
      setReady(true);
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  const apply = useCallback((next: AdminUserFilters) => {
    setFilters(next);
    window.history.pushState(null, '', `/admin/users?${adminUserQuery(next)}`);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    // Do not present the previous filter's rows or KPIs as current.
    setReport(null);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/users?${adminUserQuery(filters)}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('ADMIN_USERS_UNAVAILABLE');
        const parsed = adminUserReportSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(parsed.total / filters.pageSize));
        if (filters.page > lastPage) { apply({ ...filters, page: lastPage }); return; }
        setReport(parsed);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [apply, filters, ready, revision]);
  return { filters, apply, report, error, loading, refresh: () => setRevision(value => value + 1) };
}
