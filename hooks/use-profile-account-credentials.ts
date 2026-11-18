'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { useProfilePasswordChange } from '@/hooks/use-profile-password-change';
import { isGoogleAuthUser } from '@/lib/oauth-profile';

export type ProfileAccountSummary = { id: string; username: string; display_name: string | null };

/** Owns credential drafts/commands; the profile directory owns display-name persistence. */
export function useProfileAccountCredentials(
  user: User | null, currentProfile: ProfileAccountSummary | null,
  saveProfileDisplayName: (profileId: string, displayName: string) => Promise<boolean>,
) {
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [activeAccountPanel, setActiveAccountPanel] = useState<'nickname' | 'password' | null>(null);

  useEffect(() => {
    if (!currentProfile) return;
    setDisplayNameDraft(currentProfile.display_name || '');
  }, [currentProfile]);

  const handleSaveOwnDisplayName = async () => {
    if (!user) return;
    setSavingDisplayName(true);
    try {
      const saved = await saveProfileDisplayName(user.id, displayNameDraft);
      if (saved) {
        setActiveAccountPanel(null);
      }
    } finally {
      setSavingDisplayName(false);
    }
  };

  const password = useProfilePasswordChange(user, activeAccountPanel === 'password', () => setActiveAccountPanel(null));

  const toggleAccountPanel = (panel: 'nickname' | 'password') => {
    setActiveAccountPanel((current) => (current === panel ? null : panel));
  };

  return {
    displayNameDraft, setDisplayNameDraft, savingDisplayName,
    ...password,
    activeAccountPanel, toggleAccountPanel, handleSaveOwnDisplayName,
    canChangePassword: Boolean(user) && !isGoogleAuthUser(user),
  };
}

export type ProfileAccountControls = ReturnType<typeof useProfileAccountCredentials>;
