'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isStrongPassword } from '@/lib/auth-validation';
import { isGoogleAuthUser } from '@/lib/oauth-profile';
import { changeProfilePassword, ProfilePasswordError } from '@/lib/profile-password';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';

type Context = { key: string | null };
type Values = { current: string; next: string; confirmation: string };
type Owner = { context: Context; enabled: boolean; controller: AbortController | null };
type State = { context: Context; values: Values; busy: boolean };
const EMPTY: Values = { current: '', next: '', confirmation: '' };

/** Sensitive drafts and commands belong to one account/email/provider and panel opening. */
export function useProfilePasswordChange(user: User | null, enabled: boolean, onSuccess: () => void) {
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const key = user && !isGoogleAuthUser(user) ? user.id + ':' + user.email : null;
  const context = useMemo<Context>(() => ({ key }), [key]);
  const ownerRef = useRef<Owner | null>(null);
  const [state, setState] = useState<State>({ context, values: EMPTY, busy: false });
  const values = state.context === context ? state.values : EMPTY;

  useLayoutEffect(() => {
    const owner: Owner = { context, enabled, controller: null };
    ownerRef.current = owner;
    // Clear a different account's secrets before paint; retain same-account error drafts.
    setState(current => ({ context, values: current.context === context ? current.values : EMPTY, busy: false }));
    return () => {
      owner.controller?.abort();
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [context, enabled]);

  const update = useCallback((field: keyof Values, value: string) => {
    const owner = ownerRef.current;
    if (owner?.context !== context || !owner.enabled || owner.controller) return;
    setState(current => current.context === context
      ? { ...current, values: { ...current.values, [field]: value } } : current);
  }, [context]);

  const handleChangePassword = async () => {
    const owner = ownerRef.current;
    if (owner?.context !== context || !owner.enabled || owner.controller || !context.key) return;
    if (!user?.email) {
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: t({ it: 'Email account non disponibile.', en: 'Account email is unavailable.' }), variant: 'destructive' });
      return;
    }
    if (!isStrongPassword(values.next)) {
      toast({ title: t({ it: 'Password troppo debole', en: 'Password too weak' }),
        description: t({ it: 'La nuova password non rispetta i requisiti di sicurezza.', en: 'The new password does not meet the security requirements.' }), variant: 'destructive' });
      return;
    }
    if (values.next !== values.confirmation) {
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: t({ it: 'Le password non coincidono.', en: 'Passwords do not match.' }), variant: 'destructive' });
      return;
    }
    const controller = new AbortController();
    owner.controller = controller;
    const active = () => ownerRef.current === owner && owner.controller === controller && !controller.signal.aborted;
    setState({ context, values, busy: true });
    try {
      await withRequestDeadline({ abortSignal: async signal => {
        const session = await supabase.auth.getSession();
        if (!active() || signal.aborted) return;
        if (session.error) throw session.error;
        if (!session.data.session) throw new ProfilePasswordError('session-unavailable');
        await changeProfilePassword({ session: session.data.session, userId: user.id, email: user.email!,
          currentPassword: values.current, newPassword: values.next, signal });
      } }, 15_000, controller.signal, 'PROFILE_PASSWORD_TIMEOUT');
      if (!active()) return;
      setState({ context, values: EMPTY, busy: false });
      toast({ title: t({ it: 'Password aggiornata', en: 'Password updated' }),
        description: t({ it: 'La tua password è stata cambiata con successo.', en: 'Your password was changed successfully.' }) });
      onSuccess();
    } catch (error) {
      if (!active() || (error instanceof Error && error.name === 'AbortError')) return;
      let message = error instanceof Error ? error.message : t({ it: 'Impossibile aggiornare la password.', en: 'Unable to update password.' });
      if (error instanceof ProfilePasswordError) message = error.code === 'current-password'
        ? t({ it: 'Password attuale non corretta.', en: 'Current password is incorrect.' })
        : t({ it: 'Sessione cambiata o in scadenza. Ricarica il profilo e riprova.', en: 'Session changed or is expiring. Reload your profile and retry.' });
      if (message === 'PROFILE_PASSWORD_TIMEOUT') message = t({ it: 'Aggiornamento password scaduto. Riprova.', en: 'Password update timed out. Please retry.' });
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: message, variant: 'destructive' });
    } finally {
      if (owner.controller === controller) {
        owner.controller = null;
        if (ownerRef.current === owner) setState(current => current.context === context ? { ...current, busy: false } : current);
      }
    }
  };

  return { currentPassword: values.current, newPassword: values.next, confirmNewPassword: values.confirmation,
    setCurrentPassword: (value: string) => update('current', value), setNewPassword: (value: string) => update('next', value),
    setConfirmNewPassword: (value: string) => update('confirmation', value),
    savingPassword: state.context === context && state.busy, handleChangePassword };
}
