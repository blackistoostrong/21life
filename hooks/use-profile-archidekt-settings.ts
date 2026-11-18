'use client';

import { useEffect, useState, type SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import type { ProfileDirectoryEntry as Profile } from '@/lib/types/profile-directory';

/** Owns existing account Archidekt settings and their profile acknowledgment. */
export function useProfileArchidektSettings(user: { id: string } | null, currentProfile: Profile | null,
  setProfiles: (action: SetStateAction<Profile[]>) => void, setArchidektUsername: (value: string) => void) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const [archidektSettingsUsername, setArchidektSettingsUsername] = useState('');

  const [archidektAutoImport, setArchidektAutoImport] = useState(false);

  const [savingArchidektSettings, setSavingArchidektSettings] = useState(false);

  useEffect(() => {
    if (!currentProfile) return;
    const savedArchidektUsername = currentProfile.archidekt_username || '';
    setArchidektSettingsUsername(savedArchidektUsername);
    setArchidektUsername(savedArchidektUsername);
    setArchidektAutoImport(Boolean(currentProfile.archidekt_auto_import));
  }, [currentProfile]);

  const handleSaveArchidektSettings = async () => {
    if (!user) return;
    const username = archidektSettingsUsername.trim() || null;
    if (archidektAutoImport && !username) {
      toast({
        title: t({ it: 'Username richiesto', en: 'Username required' }),
        description: t({ it: 'Inserisci il tuo username Archidekt per abilitare il controllo automatico.', en: 'Enter your Archidekt username to enable automatic checks.' }),
        variant: 'destructive',
      });
      return;
    }

    setSavingArchidektSettings(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          archidekt_username: username,
          archidekt_auto_import: archidektAutoImport,
        })
        .eq('id', user.id);
      if (error) throw error;

      setProfiles((current) => current.map((profile) => profile.id === user.id ? {
        ...profile,
        archidekt_username: username,
        archidekt_auto_import: archidektAutoImport,
      } : profile));
      setArchidektUsername(username || '');
      toast({ title: t({ it: 'Archidekt configurato', en: 'Archidekt configured' }) });
    } catch (error) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile salvare le impostazioni Archidekt.', en: 'Unable to save Archidekt settings.' })),
        variant: 'destructive',
      });
    } finally {
      setSavingArchidektSettings(false);
    }
  };

  return { archidektSettingsUsername, setArchidektSettingsUsername, archidektAutoImport,
    setArchidektAutoImport, savingArchidektSettings, handleSaveArchidektSettings };
}
export type ProfileArchidektSettingsControls = ReturnType<typeof useProfileArchidektSettings>;
