'use client';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';
import { DoorOpen, Trash2 } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { isLeaveArenaConfirmationValid } from '@/lib/leave-arena-confirm';
import type { Group } from '@/lib/types/arena-catalog';
import type { useArenaMembership } from '@/hooks/use-arena-membership';

export function ArenaMembershipDialogs({group, controls}: {group: Group | null; controls: ReturnType<typeof useArenaMembership>}) {
  const { copy: t } = useLanguage();
  const { showDeleteArenaModal, showLeaveArenaModal, leaveArenaConfirmation, deleteArenaConfirmation,
    leavingArena, deletingArena, setShowLeaveArenaModal, setLeaveArenaConfirmation,
    setDeleteArenaConfirmation, setShowDeleteArenaModal, handleDeleteGroup, handleLeaveArena } = controls;
  return <>
      {showLeaveArenaModal && group && (
        <ModalOverlay>
          <ModalCard>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <DoorOpen className="h-5 w-5" />
                {t({ it: 'Esci dal playgroup', en: 'Leave playgroup' })}
              </CardTitle>
              <CardDescription>
                {t({
                  it: 'Perderai accesso a questo playgroup, ma le partite già registrate resteranno nello storico del gruppo.',
                  en: 'You will lose access to this playgroup, but battles already recorded will remain in the group history.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="rounded-md border border-border/70 bg-background/35 p-3 text-sm text-muted-foreground">
                  {t({ it: 'Per confermare, scrivi:', en: 'To confirm, type:' })}
                  <div className="mt-2 font-semibold text-foreground">confirm</div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="leaveArenaConfirmation" className="text-sm font-medium text-foreground">
                    {t({ it: 'Conferma', en: 'Confirmation' })}
                  </label>
                  <Input
                    id="leaveArenaConfirmation"
                    value={leaveArenaConfirmation}
                    onChange={(e) => setLeaveArenaConfirmation(e.target.value)}
                    placeholder="confirm"
                    className="border-border bg-background/50 text-foreground placeholder:text-muted-foreground"
                    autoComplete="off"
                    autoFocus
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1 border-border text-foreground"
                    onClick={() => {
                      setShowLeaveArenaModal(false);
                      setLeaveArenaConfirmation('');
                    }}
                    disabled={leavingArena}
                  >
                    {t({ it: 'Annulla', en: 'Cancel' })}
                  </Button>
                  <Button
                    className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                    onClick={handleLeaveArena}
                    disabled={leavingArena || !isLeaveArenaConfirmationValid(leaveArenaConfirmation)}
                  >
                    {leavingArena ? t({ it: 'Uscita...', en: 'Leaving...' }) : t({ it: 'Esci', en: 'Leave' })}
                  </Button>
                </div>
              </div>
            </CardContent>
          </ModalCard>
        </ModalOverlay>
      )}

      {showDeleteArenaModal && group && (
        <ModalOverlay>
          <ModalCard className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-5 w-5" />
                {t({ it: 'Elimina playgroup', en: 'Delete Playgroup' })}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t({
                  it: 'Questa azione rimuove playgroup, partite e iscrizioni collegate. Non può essere annullata.',
                  en: 'This removes the playgroup, battles, and memberships. It cannot be undone.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-muted-foreground">
                  {t({ it: 'Per confermare, scrivi esattamente:', en: 'To confirm, type exactly:' })}
                  <div className="mt-2 break-words font-semibold text-foreground">{group.name}</div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    {t({ it: 'Nome playgroup', en: 'Playgroup name' })}
                  </label>
                  <Input
                    value={deleteArenaConfirmation}
                    onChange={(e) => setDeleteArenaConfirmation(e.target.value)}
                    placeholder={group.name}
                    className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground"
                    autoFocus
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 border-border text-foreground"
                    onClick={() => setShowDeleteArenaModal(false)}
                    disabled={deletingArena}
                  >
                    {t({ it: 'Annulla', en: 'Cancel' })}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="flex-1"
                    onClick={handleDeleteGroup}
                    disabled={deletingArena || deleteArenaConfirmation !== group.name}
                  >
                    {deletingArena ? t({ it: 'Eliminazione...', en: 'Deleting...' }) : t({ it: 'Elimina playgroup', en: 'Delete Playgroup' })}
                  </Button>
                </div>
              </div>
            </CardContent>
          </ModalCard>
        </ModalOverlay>
      )}
  </>;
}
