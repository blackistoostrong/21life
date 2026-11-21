'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { isAdministrator } from '@/lib/admin';
import { supabase } from '@/lib/supabase';
import { withRequestDeadline } from '@/packages/data/request-deadline';

type Identity = { userId: string | null; email: string };
type RoleState = { identity: Identity; adminMode: boolean };

export function usePlatformAdmin() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const email = user?.email?.toLowerCase() ?? '';
  const identity = useMemo<Identity>(() => ({ userId, email }), [userId, email]);
  const [role, setRole] = useState<RoleState | null>(null);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setRole({ identity, adminMode: false });
      return;
    }

    if (isAdministrator(user)) {
      setRole({ identity, adminMode: true });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    // Revalidate every Auth snapshot without discarding the already-known role
    // for the same identity. A different identity is masked immediately below.
    void withRequestDeadline(supabase.rpc('is_admin', { p_user_id: user.id }), 15000, controller.signal).then(({ data, error }) => {
      if (cancelled) return;
      setRole({ identity, adminMode: !error && data === true });
    }).catch(() => {
      if (!cancelled) setRole({ identity, adminMode: false });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authLoading, identity, user]);

  return {
    adminMode: !authLoading && role?.identity === identity ? role.adminMode : false,
    loading: authLoading || role?.identity !== identity,
  };
}
