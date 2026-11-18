'use client';

import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { User as UserIcon, Lock, Mail, Calendar, Save } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordRequirements } from '@/components/auth/password-requirements';
import { isStrongPassword as isPasswordPolicyValid } from '@/lib/auth-validation';
import { getProfileDisplayName } from '@/lib/profile-display';
import { useLanguage } from '@/components/language-provider';
import type { ProfileAccountControls, ProfileAccountSummary } from '@/hooks/use-profile-account-credentials';

export const PROFILE_ACCOUNT_INPUT_CLASS = 'border-emerald-500/25 bg-emerald-950/35 text-foreground placeholder:text-emerald-300/35 focus-visible:ring-emerald-400/35';

export function ProfileAccountPanel({ user, currentProfile, adminMode, controls, children }: {
  user: User; currentProfile: ProfileAccountSummary | null; adminMode: boolean;
  controls: ProfileAccountControls; children?: ReactNode;
}) {
  const { copy: t } = useLanguage();
  const accountPanelInputClass = PROFILE_ACCOUNT_INPUT_CLASS;
  const { displayNameDraft, setDisplayNameDraft, savingDisplayName,
    currentPassword, setCurrentPassword, newPassword, setNewPassword,
    confirmNewPassword, setConfirmNewPassword, savingPassword,
    activeAccountPanel, toggleAccountPanel, handleSaveOwnDisplayName, handleChangePassword,
    canChangePassword } = controls;
  const accountActionButtonClass = (active: boolean) => (
    active
      ? 'flex w-full items-center gap-2.5 rounded-lg bg-emerald-500/25 px-3 py-2.5 text-sm font-medium text-emerald-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-emerald-400/40 transition-all'
      : 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-emerald-200/80 transition-all hover:bg-emerald-500/12 hover:text-emerald-50'
  );

  return (
          <Card className="phyrexian-panel-strong mb-8 overflow-hidden">
            <CardContent className="relative pt-6">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-red-700 lg:bg-none lg:bg-primary/50" />
              <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-teal-400/10 blur-3xl lg:hidden" />
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-4 sm:w-48 sm:items-stretch sm:border-r sm:border-emerald-400/15 sm:pr-6">
                <div className="flex justify-center" aria-hidden="true">
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-emerald-400/35 sm:h-20 sm:w-20">
                    <UserIcon className="h-10 w-10 sm:h-12 sm:w-12" />
                  </div>
                </div>

                <div className="w-full space-y-1 rounded-xl border border-emerald-400/20 bg-emerald-950/20 p-1.5 backdrop-blur-sm">
                  <p className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300/45">
                    {t({ it: 'Account', en: 'Account' })}
                  </p>
                  <button
                    type="button"
                    className={accountActionButtonClass(activeAccountPanel === 'nickname')}
                    onClick={() => toggleAccountPanel('nickname')}
                  >
                    <UserIcon className="h-4 w-4 shrink-0 text-emerald-300/90" />
                    {t({ it: 'Nick', en: 'Nickname' })}
                  </button>
                  {canChangePassword ? (
                    <button
                      type="button"
                      className={accountActionButtonClass(activeAccountPanel === 'password')}
                      onClick={() => toggleAccountPanel('password')}
                    >
                      <Lock className="h-4 w-4 shrink-0 text-emerald-300/90" />
                      {t({ it: 'Password', en: 'Password' })}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="min-w-0 flex-1 sm:pt-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {adminMode && (
                    <span className="rounded border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-teal-200">
                      Admin
                    </span>
                  )}
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-2 break-words">
                  {getProfileDisplayName(currentProfile) || user.user_metadata?.username || user.email?.split('@')[0] || t({ it: 'Giocatore', en: 'Planeswalker' })}
                </h2>
                {currentProfile && currentProfile.display_name && (
                  <p className="mb-2 text-sm text-muted-foreground">
                    @{currentProfile.username}
                  </p>
                )}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-muted-foreground">
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="w-4 h-4" />
                    <span className="truncate">{user.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span>{t({ it: 'Dal', en: 'Joined' })} {format(new Date(user.created_at || new Date()), 'MMMM yyyy')}</span>
                  </div>
                </div>
              </div>
              </div>

              {activeAccountPanel === 'nickname' ? (
                <div className="mt-6 overflow-hidden rounded-xl border border-emerald-400/20 bg-emerald-950/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
                  <p className="mb-3 text-sm text-emerald-200/70">
                    {t({
                      it: 'Questo nome viene mostrato nelle classifiche e nelle partite. Lo username resta invariato.',
                      en: 'This name is shown in rankings and battles. Your username stays unchanged.',
                    })}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <Input
                      value={displayNameDraft}
                      onChange={(event) => setDisplayNameDraft(event.target.value)}
                      placeholder={currentProfile?.username || t({ it: 'Nick visualizzato', en: 'Display nickname' })}
                      className={accountPanelInputClass}
                    />
                    <Button
                      onClick={handleSaveOwnDisplayName}
                      disabled={savingDisplayName || !currentProfile || displayNameDraft.trim() === (currentProfile.display_name || '')}
                      className="bg-gradient-to-r from-emerald-600 to-teal-700 shadow-[0_8px_24px_rgba(124,58,237,0.28)] hover:from-emerald-500 hover:to-teal-600"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {savingDisplayName ? t({ it: 'Salvataggio...', en: 'Saving...' }) : t({ it: 'Salva nick', en: 'Save nickname' })}
                    </Button>
                  </div>
                </div>
              ) : null}

              {activeAccountPanel === 'password' && canChangePassword ? (
                <div className="mt-6 overflow-hidden rounded-xl border border-emerald-400/20 bg-emerald-950/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
                  <p className="mb-3 text-sm text-emerald-200/70">
                    {t({
                      it: 'Aggiorna la password del tuo account senza usare la email.',
                      en: 'Update your account password without using email.',
                    })}
                  </p>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="currentPassword" className="text-sm font-medium text-emerald-100/90">
                        {t({ it: 'Password attuale', en: 'Current password' })}
                      </label>
                      <Input
                        id="currentPassword"
                        name="currentPassword"
                        type="password"
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        autoComplete="current-password"
                        autoCapitalize="none"
                        spellCheck={false}
                        className={accountPanelInputClass}
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="newPassword" className="text-sm font-medium text-emerald-100/90">
                        {t({ it: 'Nuova password', en: 'New password' })}
                      </label>
                      <Input
                        id="newPassword"
                        name="newPassword"
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        autoComplete="new-password"
                        autoCapitalize="none"
                        spellCheck={false}
                        className={accountPanelInputClass}
                      />
                      <PasswordRequirements password={newPassword} />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="confirmNewPassword" className="text-sm font-medium text-emerald-100/90">
                        {t({ it: 'Conferma nuova password', en: 'Confirm new password' })}
                      </label>
                      <Input
                        id="confirmNewPassword"
                        name="confirmNewPassword"
                        type="password"
                        value={confirmNewPassword}
                        onChange={(event) => setConfirmNewPassword(event.target.value)}
                        autoComplete="new-password"
                        autoCapitalize="none"
                        spellCheck={false}
                        className={accountPanelInputClass}
                      />
                      {confirmNewPassword.length > 0 && confirmNewPassword !== newPassword ? (
                        <p className="text-xs text-red-300/90">
                          {t({ it: 'Le password non coincidono.', en: 'Passwords do not match.' })}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      onClick={handleChangePassword}
                      disabled={
                        savingPassword
                        || !currentPassword
                        || !isPasswordPolicyValid(newPassword)
                        || newPassword !== confirmNewPassword
                      }
                      className="bg-gradient-to-r from-emerald-600 to-teal-700 shadow-[0_8px_24px_rgba(124,58,237,0.28)] hover:from-emerald-500 hover:to-teal-600"
                    >
                      <Lock className="mr-2 h-4 w-4" />
                      {savingPassword
                        ? t({ it: 'Aggiornamento...', en: 'Updating...' })
                        : t({ it: 'Aggiorna password', en: 'Update password' })}
                    </Button>
                  </div>
                </div>
              ) : null}

              {children}
            </CardContent>
          </Card>
  );
}
