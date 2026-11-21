'use client';

import { AdminPage } from '@/components/admin/admin-page';
import { AdminUsersPanel } from '@/components/admin/admin-users-panel';
import { useLanguage } from '@/components/language-provider';

export default function AdminUsersPage() {
  const { copy: t } = useLanguage();
  return <AdminPage title={t({ it: 'Utenti e attività', en: 'Users and activity' })}
    description={t({ it: 'Trova le utenze, controlla la crescita ed esporta i report filtrati.', en: 'Find accounts, monitor growth and export filtered reports.' })}>
    <AdminUsersPanel />
  </AdminPage>;
}
