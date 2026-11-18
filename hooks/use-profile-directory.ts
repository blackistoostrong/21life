'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import type { ProfileDirectoryEntry as Profile } from '@/lib/types/profile-directory';

type Context = { key: string | null };
type Owner = { context: Context; load: AbortController | null; saves: Map<string, AbortController> };
type State = { context: Context; profiles: Profile[]; drafts: Record<string, string>; saving: string[] };
const EMPTY_PROFILES: Profile[] = [];
const EMPTY_DRAFTS: Record<string, string> = {};
const EMPTY_IDS: string[] = [];

/** Directory requests and callbacks belong to one committed account/role context. */
export function useProfileDirectory(user: { id: string } | null, adminMode: boolean, adminLoading: boolean) {
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const userId = user?.id ?? null;
  const key = userId && !adminLoading ? userId + ':' + adminMode : null;
  const context = useMemo<Context>(() => ({ key }), [key]);
  const ownerRef = useRef<Owner | null>(null);
  const [state, setState] = useState<State | null>(null);

  useLayoutEffect(() => {
    const owner: Owner = { context, load: null, saves: new Map() };
    ownerRef.current = owner;
    return () => {
      owner.load?.abort();
      owner.saves.forEach(controller => controller.abort());
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [context]);

  const update = useCallback((action: (current: State) => State) => {
    if (ownerRef.current?.context !== context || !context.key) return;
    setState(current => ownerRef.current?.context === context && current?.context === context ? action(current) : current);
  }, [context]);
  const setProfiles = useCallback((action: SetStateAction<Profile[]>) => {
    update(current => ({ ...current, profiles: typeof action === 'function' ? action(current.profiles) : action }));
  }, [update]);
  const setProfileDisplayNameDrafts = useCallback((action: SetStateAction<Record<string, string>>) => {
    update(current => ({ ...current, drafts: typeof action === 'function' ? action(current.drafts) : action }));
  }, [update]);

  const fetchProfiles = useCallback(async () => {
    const owner = ownerRef.current;
    if (!context.key || owner?.context !== context || owner.saves.size) return;
    owner.load?.abort();
    const controller = new AbortController();
    owner.load = controller;
    const active = () => ownerRef.current === owner && owner.load === controller && !controller.signal.aborted;
    try {
      const { data, error } = await withRequestDeadline(supabase.from('profiles')
        .select('id, username, display_name, archidekt_username, archidekt_auto_import, archidekt_last_sync_at')
        .order('username', { ascending: true }), 15000, controller.signal);
      if (!active()) return;
      if (error) throw error;
      const profiles = data || [];
      setState(current => {
        if (!active()) return current;
        const previous = current?.context === context ? current : null;
        const previousProfiles = new Map(previous?.profiles.map(profile => [profile.id, profile]));
        const drafts = Object.fromEntries(profiles.map(profile => {
          const oldProfile = previousProfiles.get(profile.id);
          const oldDraft = previous?.drafts[profile.id];
          const dirty = oldDraft !== undefined && oldDraft !== (oldProfile?.display_name || '');
          return [profile.id, dirty ? oldDraft : profile.display_name || ''];
        }));
        return { context, profiles, drafts, saving: [] };
      });
    } catch {
      if (active()) toast({ title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Impossibile caricare i giocatori', en: 'Failed to load players' }), variant: 'destructive' });
    }
  }, [context, t, toast]);

  const saveProfileDisplayName = async (profileId: string, nextDisplayName: string, signal?: AbortSignal): Promise<boolean> => {
    const owner = ownerRef.current;
    if (signal?.aborted || !context.key || owner?.context !== context || owner.saves.has(profileId)
      || (!adminMode && profileId !== userId)) return false;
    // An older directory read must never overwrite an acknowledged nickname write.
    owner.load?.abort();
    const controller = new AbortController();
    owner.saves.set(profileId, controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const active = () => ownerRef.current === owner && owner.saves.get(profileId) === controller && !controller.signal.aborted;
    const displayName = nextDisplayName.trim() || null;
    update(current => ({ ...current, saving: [...current.saving, profileId] }));
    try {
      const { error } = await withRequestDeadline(supabase.from('profiles')
        .update({ display_name: displayName }).eq('id', profileId), 15000, controller.signal);
      if (!active()) return false;
      if (error) throw error;
      update(current => ({ ...current,
        profiles: current.profiles.map(profile => profile.id === profileId ? { ...profile, display_name: displayName } : profile),
        drafts: { ...current.drafts, [profileId]: displayName || '' } }));
      toast({ title: t({ it: 'Nick aggiornato', en: 'Nickname updated' }) });
      return true;
    } catch (error: unknown) {
      if (active()) toast({ title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile salvare il nick', en: 'Failed to save nickname' })), variant: 'destructive' });
      return false;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (ownerRef.current === owner && owner.saves.get(profileId) === controller) {
        owner.saves.delete(profileId);
        update(current => ({ ...current, saving: current.saving.filter(id => id !== profileId) }));
      }
    }
  };

  const current = state?.context === context ? state : null;
  return { profiles: current?.profiles ?? EMPTY_PROFILES, setProfiles,
    profileDisplayNameDrafts: current?.drafts ?? EMPTY_DRAFTS, setProfileDisplayNameDrafts,
    savingProfileDisplayNameIds: current?.saving ?? EMPTY_IDS, fetchProfiles, saveProfileDisplayName };
}

export type ProfileDirectoryControls = ReturnType<typeof useProfileDirectory>;
