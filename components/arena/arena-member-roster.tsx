'use client';
import { useLanguage } from '@/components/language-provider';
import type { Group, Profile } from '@/lib/types/arena-catalog';
import type { useArenaMembership } from '@/hooks/use-arena-membership';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DirectArenaInvite } from '@/components/arena/direct-arena-invite';
import { canKickArenaMember } from '@/lib/arena-membership';
import { getProfileDisplayName } from '@/lib/profile-display';
import { Users, UserMinus } from 'lucide-react';

type Props = { members: Profile[]; group: Group; userId: string | null;
  adminMode: boolean; canManageGroup: boolean;
  controls: Pick<ReturnType<typeof useArenaMembership>, 'membershipBusy' | 'kickingMemberIds' | 'handleKickMember'>; };

/** Presentation only; report availability never gates membership management. */
export function ArenaMemberRoster({ members, group, userId, adminMode, canManageGroup, controls }: Props) {
  const { copy: t } = useLanguage();
  const { membershipBusy, kickingMemberIds, handleKickMember } = controls;
  return <Card className="bg-card/50 border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <Users className="h-5 w-5" />
                      {t({ it: 'Membri del playgroup', en: 'Playgroup members' })}
                    </CardTitle>
                    <CardDescription>
                      {t({
                        it: 'Giocatori registrati con accesso al playgroup. Uscire o essere rimossi non cancella le partite già registrate.',
                        en: 'Registered players with access to this playgroup. Leaving or being removed does not delete past battles.',
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {members.map((member) => {
                        const isCreator = group?.created_by === member.id;
                        const canKick = canKickArenaMember({
                          actorId: userId || '',
                          targetId: member.id,
                          group,
                          isPlatformAdmin: adminMode,
                        });

                        return (
                          <div
                            key={member.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-secondary/30 px-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-foreground">{getProfileDisplayName(member)}</p>
                                <span className="text-xs text-muted-foreground">@{member.username}</span>
                                {isCreator && (
                                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                                    {t({ it: 'Creatore', en: 'Creator' })}
                                  </span>
                                )}
                                {member.id === userId && (
                                  <span className="rounded-full border border-border/70 bg-background/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                    {t({ it: 'Tu', en: 'You' })}
                                  </span>
                                )}
                              </div>
                            </div>
                            {canKick && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() => handleKickMember(member)}
                                disabled={membershipBusy}
                                title={t({ it: 'Rimuovi membro', en: 'Remove member' })}
                              >
                                <UserMinus className={`h-4 w-4 ${kickingMemberIds.includes(member.id) ? 'animate-pulse' : ''}`} />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {canManageGroup && group ? <DirectArenaInvite groupId={group.id} /> : null}
                  </CardContent>
                </Card>;
}
