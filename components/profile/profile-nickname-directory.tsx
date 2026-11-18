'use client';

import { Save } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';
import { getProfileDisplayName } from '@/lib/profile-display';
import type { ProfileDirectoryControls } from '@/hooks/use-profile-directory';

type NicknameControls = Pick<ProfileDirectoryControls, 'profiles' | 'profileDisplayNameDrafts'
  | 'setProfileDisplayNameDrafts' | 'savingProfileDisplayNameIds' | 'saveProfileDisplayName'>;

export function ProfileNicknameDirectory({ directory }: { directory: NicknameControls }) {
  const { copy: t } = useLanguage();
  const { profiles, profileDisplayNameDrafts, setProfileDisplayNameDrafts,
    savingProfileDisplayNameIds, saveProfileDisplayName } = directory;
  return (
          <Card className="phyrexian-panel mb-8">
            <CardHeader>
              <CardTitle className="text-foreground">{t({ it: 'Nick giocatori', en: 'Player nicknames' })}</CardTitle>
              <CardDescription>
                {t({
                  it: 'L\'admin puo modificare il nome visualizzato di ogni account senza cambiare lo username.',
                  en: 'Admins can edit each account display name without changing usernames.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {profiles.map((profile) => {
                  const savingProfile = savingProfileDisplayNameIds.includes(profile.id);
                  const draft = profileDisplayNameDrafts[profile.id] || '';
                  return (
                    <div key={profile.id} className="grid gap-2 rounded-lg border border-border/70 bg-background/30 p-3 md:grid-cols-[minmax(0,220px)_1fr_auto] md:items-center">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{getProfileDisplayName(profile)}</p>
                        <p className="text-xs text-muted-foreground truncate">@{profile.username}</p>
                      </div>
                      <Input
                        value={draft}
                        onChange={(event) => setProfileDisplayNameDrafts((drafts) => ({ ...drafts, [profile.id]: event.target.value }))}
                        placeholder={profile.username}
                        className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="border-border text-foreground"
                        onClick={() => saveProfileDisplayName(profile.id, draft)}
                        disabled={savingProfile || draft.trim() === (profile.display_name || '')}
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {savingProfile ? t({ it: 'Salvo...', en: 'Saving...' }) : t({ it: 'Salva', en: 'Save' })}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
  );
}
