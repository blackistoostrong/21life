'use client';

import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { useProfileCommandScope, type ProfileCommandJob } from '@/hooks/use-profile-command-scope';
import { supabase } from '@/lib/supabase';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import type { ProfileDirectoryEntry as Profile } from '@/lib/types/profile-directory';

type Scope = ReturnType<typeof useProfileCommandScope>;
type State = { context: Scope['context']; username: string; automatic: boolean;
  sourceUsername: string; sourceAutomatic: boolean; job: ProfileCommandJob | null };
const empty = (context: Scope['context']): State => ({ context, username: '', automatic: false,
  sourceUsername: '', sourceAutomatic: false, job: null });

/** Account settings own their draft and save; public import owns its separate input. */
export function useProfileArchidektSettings(key: string | null, userId: string | null, currentProfile: Profile | null,
  setProfiles: (action: SetStateAction<Profile[]>) => void) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const { context, epoch, committed, begin, pending } = useProfileCommandScope(key, Boolean(userId));
  const [state, setState] = useState<State>(() => empty(context));
  const current = state.context === context ? state : empty(context);
  const savedUsername = currentProfile?.archidekt_username || '';
  const savedAutomatic = Boolean(currentProfile?.archidekt_auto_import);
  const update = useCallback((action: (previous: State) => State, job?: ProfileCommandJob) => {
    if (!committed() || (job && !job.active())) return;
    setState(previous => !committed() || (job && !job.active()) ? previous
      : action(previous.context === context ? previous : empty(context)));
  }, [committed, context]);

  useEffect(() => {
    update(previous => {
      if (previous.sourceUsername === savedUsername && previous.sourceAutomatic === savedAutomatic) return previous;
      const dirty = previous.username !== previous.sourceUsername || previous.automatic !== previous.sourceAutomatic;
      return { ...previous, sourceUsername: savedUsername, sourceAutomatic: savedAutomatic,
        ...(!dirty && !previous.job ? { username: savedUsername, automatic: savedAutomatic } : {}) };
    });
  }, [savedUsername, savedAutomatic, update]);

  const setArchidektSettingsUsername = (value: string) => {
    if (!pending('save')) update(previous => ({ ...previous, username: value }));
  };
  const setArchidektAutoImport = (value: boolean) => {
    if (!pending('save')) update(previous => ({ ...previous, automatic: value }));
  };
  const handleSaveArchidektSettings = async () => {
    if (!userId || pending('save')) return;
    const username = current.username.trim() || null;
    const automatic = current.automatic;
    if (automatic && !username) {
      toast({ title: t({ it: 'Username richiesto', en: 'Username required' }),
        description: t({ it: 'Inserisci il tuo username Archidekt per abilitare il controllo automatico.', en: 'Enter your Archidekt username to enable automatic checks.' }),
        variant: 'destructive' });
      return;
    }
    const job = begin('save');
    if (!job) return;
    update(previous => ({ ...previous, job }), job);
    try {
      const { error } = await withRequestDeadline(supabase.from('profiles')
        .update({ archidekt_username: username, archidekt_auto_import: automatic })
        .eq('id', userId), 15000, job.signal);
      if (error) throw error;
      if (!job.active()) return;
      setProfiles(profiles => !job.active() ? profiles : profiles.map(profile => profile.id === userId ? {
        ...profile, archidekt_username: username, archidekt_auto_import: automatic,
      } : profile));
      update(previous => ({ ...previous, username: username || '', automatic,
        sourceUsername: username || '', sourceAutomatic: automatic }), job);
      toast({ title: t({ it: 'Archidekt configurato', en: 'Archidekt configured' }) });
    } catch (error) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile salvare le impostazioni Archidekt.', en: 'Unable to save Archidekt settings.' })),
        variant: 'destructive' });
    } finally {
      update(previous => ({ ...previous, job: null }), job);
      job.finish();
    }
  };
  return { archidektSettingsUsername: current.username, setArchidektSettingsUsername,
    archidektAutoImport: current.automatic, setArchidektAutoImport,
    savingArchidektSettings: current.job?.epoch === epoch, handleSaveArchidektSettings };
}
export type ProfileArchidektSettingsControls = ReturnType<typeof useProfileArchidektSettings>;
