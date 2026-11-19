'use client';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';
import { authenticatedFetch } from '@/lib/authenticated-fetch';

export function useProfileAccountExport() {
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const [exportingAccount, setExportingAccount] = useState(false);

  const exportAccountData = async () => {
    setExportingAccount(true);
    try {
      const response = await authenticatedFetch('/api/auth/export-account');
      if (!response.ok) throw new Error(t({ it: 'Export non riuscito.', en: 'Export failed.' }));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mtg-tracker-account-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: t({ it: 'Dati account esportati', en: 'Account data exported' }) });
    } catch (error) {
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setExportingAccount(false);
    }
  };
  return { exportingAccount, exportAccountData };
}
