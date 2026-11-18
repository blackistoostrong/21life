'use client';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import type { ProfileDirectoryEntry as Profile } from '@/lib/types/profile-directory';

/** Directory loading, nickname drafts and persistence share one feature owner. */
export function useProfileDirectory() {
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileDisplayNameDrafts, setProfileDisplayNameDrafts] = useState<Record<string, string>>({});
  const [savingProfileDisplayNameIds, setSavingProfileDisplayNameIds] = useState<string[]>([]);

  const fetchProfiles = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, archidekt_username, archidekt_auto_import, archidekt_last_sync_at')
        .order('username', { ascending: true });

      if (error) throw error;
      const loadedProfiles = data || [];
      setProfiles(loadedProfiles);
      setProfileDisplayNameDrafts(loadedProfiles.reduce((drafts: Record<string, string>, profile) => {
        drafts[profile.id] = profile.display_name || '';
        return drafts;
      }, {}));
    } catch (error) {
      console.error('Error fetching profiles:', error);
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Impossibile caricare i giocatori', en: 'Failed to load players' }),
        variant: 'destructive',
      });
    }
  }, [t, toast]);

  const saveProfileDisplayName = async (profileId: string, nextDisplayName: string): Promise<boolean> => {
    const displayName = nextDisplayName.trim() || null;
    setSavingProfileDisplayNameIds((ids) => [...ids, profileId]);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', profileId);

      if (error) throw error;

      setProfiles((currentProfiles) => currentProfiles.map((profile) =>
        profile.id === profileId ? { ...profile, display_name: displayName } : profile
      ));
      setProfileDisplayNameDrafts((drafts) => ({ ...drafts, [profileId]: displayName || '' }));
      toast({ title: t({ it: 'Nick aggiornato', en: 'Nickname updated' }) });
      return true;
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile salvare il nick', en: 'Failed to save nickname' })),
        variant: 'destructive',
      });
      return false;
    } finally {
      setSavingProfileDisplayNameIds((ids) => ids.filter((id) => id !== profileId));
    }
  };

  return { profiles, setProfiles, profileDisplayNameDrafts, setProfileDisplayNameDrafts,
    savingProfileDisplayNameIds, fetchProfiles, saveProfileDisplayName };
}

export type ProfileDirectoryControls = ReturnType<typeof useProfileDirectory>;
