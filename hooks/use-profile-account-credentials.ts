'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';
import { isStrongPassword as isPasswordPolicyValid } from '@/lib/auth-validation';
import { isGoogleAuthUser } from '@/lib/oauth-profile';

export type ProfileAccountSummary = { id: string; username: string; display_name: string | null };

/** Owns credential drafts/commands; the profile directory owns display-name persistence. */
export function useProfileAccountCredentials(
  user: User | null, currentProfile: ProfileAccountSummary | null,
  saveProfileDisplayName: (profileId: string, displayName: string) => Promise<boolean>,
) {
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
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

  const handleChangePassword = async () => {
    if (!user?.email) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Email account non disponibile.', en: 'Account email is unavailable.' }),
        variant: 'destructive',
      });
      return;
    }

    if (!isPasswordPolicyValid(newPassword)) {
      toast({
        title: t({ it: 'Password troppo debole', en: 'Password too weak' }),
        description: t({
          it: 'La nuova password non rispetta i requisiti di sicurezza.',
          en: 'The new password does not meet the security requirements.',
        }),
        variant: 'destructive',
      });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Le password non coincidono.', en: 'Passwords do not match.' }),
        variant: 'destructive',
      });
      return;
    }

    setSavingPassword(true);

    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (verifyError) {
        throw new Error(t({ it: 'Password attuale non corretta.', en: 'Current password is incorrect.' }));
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        throw updateError;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');

      toast({
        title: t({ it: 'Password aggiornata', en: 'Password updated' }),
        description: t({
          it: 'La tua password è stata cambiata con successo.',
          en: 'Your password was changed successfully.',
        }),
      });
      setActiveAccountPanel(null);
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error
          ? error.message
          : t({ it: 'Impossibile aggiornare la password.', en: 'Unable to update password.' }),
        variant: 'destructive',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const toggleAccountPanel = (panel: 'nickname' | 'password') => {
    setActiveAccountPanel((current) => (current === panel ? null : panel));
  };

  return {
    displayNameDraft, setDisplayNameDraft, savingDisplayName,
    currentPassword, setCurrentPassword, newPassword, setNewPassword,
    confirmNewPassword, setConfirmNewPassword, savingPassword,
    activeAccountPanel, toggleAccountPanel, handleSaveOwnDisplayName, handleChangePassword,
    canChangePassword: Boolean(user) && !isGoogleAuthUser(user),
  };
}

export type ProfileAccountControls = ReturnType<typeof useProfileAccountCredentials>;
