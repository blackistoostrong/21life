'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformAdmin } from '@/hooks/use-platform-admin';
import { useLanguage } from '@/components/language-provider';
import { AppLoader } from '@/components/ui/app-loader';
import { AdminShell } from '@/components/admin/admin-shell';

export function AdminPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { adminMode, loading: roleLoading } = usePlatformAdmin();
  const { copy: t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const loading = authLoading || roleLoading;
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/auth/login?redirect=${encodeURIComponent(pathname)}`);
    else if (!adminMode) router.replace('/dashboard');
  }, [loading, user, adminMode, pathname, router]);
  if (loading || !user || !adminMode) return <AppLoader label={t({ it: 'Verifica accesso…', en: 'Checking access…' })} />;
  return <AdminShell title={title} description={description}>{children}</AdminShell>;
}
