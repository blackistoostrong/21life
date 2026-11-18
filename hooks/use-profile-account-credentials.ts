'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { useProfilePasswordChange } from '@/hooks/use-profile-password-change';
import { isGoogleAuthUser } from '@/lib/oauth-profile';

export type ProfileAccountSummary = { id: string; username: string; display_name: string | null };
type Panel = 'nickname' | 'password' | null;
type Context = { id: string | null };
type State = { context: Context; draft: string; source: string | undefined; busy: boolean; panel: Panel };
type Owner = { context: Context; controller: AbortController | null };

/** Owns account drafts and panel commands; directory owns display-name persistence. */
export function useProfileAccountCredentials(
  user: User | null, currentProfile: ProfileAccountSummary | null,
  saveProfileDisplayName: (profileId: string, displayName: string, signal?: AbortSignal) => Promise<boolean>,
) {
  const userId = user?.id ?? null;
  const context = useMemo<Context>(() => ({ id: userId }), [userId]);
  const source = currentProfile?.id === userId ? currentProfile?.display_name || '' : undefined;
  const blank = { context, draft: source || '', source, busy: false, panel: null };
  const [state, setState] = useState<State>(blank);
  const current = state.context === context ? state : blank;
  const ownerRef = useRef<Owner | null>(null);

  useLayoutEffect(() => {
    const owner: Owner = { context, controller: null };
    ownerRef.current = owner;
    return () => {
      owner.controller?.abort();
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [context]);

  useEffect(() => {
    if (ownerRef.current?.context !== context) return;
    setState(previous => {
      if (ownerRef.current?.context !== context) return previous;
      if (previous.context !== context) return { context, draft: source || '', source, busy: false, panel: null };
      const dirty = previous.draft !== (previous.source || '');
      return { ...previous, source, draft: dirty && previous.panel === 'nickname' ? previous.draft : source || '' };
    });
  }, [context, source]);

  const closePanel = useCallback(() => {
    if (ownerRef.current?.context !== context) return;
    setState(previous => previous.context === context ? { ...previous, panel: null } : previous);
  }, [context]);
  const password = useProfilePasswordChange(user, current.panel === 'password', closePanel);

  const setDisplayNameDraft = (draft: string) => {
    if (ownerRef.current?.context !== context || ownerRef.current.controller) return;
    setState({ ...current, draft });
  };
  const toggleAccountPanel = (panel: Exclude<Panel, null>) => {
    const owner = ownerRef.current;
    if (owner?.context !== context) return;
    owner.controller?.abort();
    owner.controller = null;
    setState({ ...current, panel: current.panel === panel ? null : panel, busy: false });
  };
  const handleSaveOwnDisplayName = async () => {
    const owner = ownerRef.current;
    if (!context.id || owner?.context !== context || owner.controller || current.panel !== 'nickname') return;
    const controller = new AbortController();
    owner.controller = controller;
    const active = () => ownerRef.current === owner && owner.controller === controller && !controller.signal.aborted;
    setState({ ...current, busy: true });
    try {
      const saved = await saveProfileDisplayName(context.id, current.draft, controller.signal);
      if (active() && saved) closePanel();
    } finally {
      if (active()) {
        owner.controller = null;
        setState(previous => previous.context === context ? { ...previous, busy: false } : previous);
      }
    }
  };

  return { displayNameDraft: current.draft, setDisplayNameDraft, savingDisplayName: current.busy,
    ...password, activeAccountPanel: current.panel, toggleAccountPanel, handleSaveOwnDisplayName,
    canChangePassword: Boolean(user) && !isGoogleAuthUser(user) };
}

export type ProfileAccountControls = ReturnType<typeof useProfileAccountCredentials>;
