'use client';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';
import { GuestCommanderPicker } from '@/components/arena/guest-commander-picker';
import { Plus, UserPlus } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import type { ArenaGuest } from '@/lib/arena-participants';
import type { useArenaGuestCommands } from '@/hooks/use-arena-guest-commands';

export function ArenaGuestDialog({ guests, controls }: {guests: ArenaGuest[]; controls: ReturnType<typeof useArenaGuestCommands>}) {
  const { copy: t } = useLanguage();
  const { showGuestModal, guestModalMode, setGuestModalMode, guestDeckTargetId, guestName, guestDeckName, setGuestDeckName, guestSelectedCommander, setGuestSelectedCommander, guestSelectedPartnerCommander, setGuestSelectedPartnerCommander, savingGuest, resetGuestModal, openAddGuestDeckModal, handleSaveGuestModal, addExistingGuestToMatch, setGuestName, setGuestDeckTargetId } = controls;
  return <>
      {showGuestModal && (
        <ModalOverlay>
          <ModalCard>
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                {guestModalMode === 'add-deck' ? <Plus className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                {guestModalMode === 'add-deck'
                  ? t({ it: 'Aggiungi mazzo guest', en: 'Add guest deck' })
                  : t({ it: 'Aggiungi guest', en: 'Add guest' })}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {guestModalMode === 'pick-existing'
                  ? t({ it: 'Scegli un guest già presente nel playgroup o creane uno nuovo', en: 'Pick an existing playgroup guest or create a new one' })
                  : guestModalMode === 'add-deck'
                    ? t({ it: 'Aggiungi un altro mazzo a questo guest', en: 'Add another deck to this guest' })
                    : t({ it: 'Crea un guest con nome e comandante', en: 'Create a guest with a name and commander' })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {guestModalMode === 'pick-existing' && guests.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    {t({ it: 'Guest esistenti', en: 'Existing guests' })}
                  </label>
                  <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                    {guests.map((guest) => (
                      <div
                        key={guest.id}
                        className="flex items-center gap-2 rounded-lg border border-border bg-background/30 px-2 py-2 transition-colors hover:border-emerald-500/50"
                      >
                        <button
                          type="button"
                          onClick={() => addExistingGuestToMatch(guest)}
                          className="flex min-w-0 flex-1 items-center justify-between px-1 text-left"
                        >
                          <span className="font-medium text-foreground">{guest.display_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {guest.arena_guest_decks?.length || 0} {t({ it: 'mazzi', en: 'decks' })}
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-emerald-300"
                          onClick={() => openAddGuestDeckModal(guest)}
                          title={t({ it: 'Aggiungi mazzo', en: 'Add deck' })}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-border text-foreground"
                    onClick={() => setGuestModalMode('create')}
                  >
                    {t({ it: 'Crea nuovo guest', en: 'Create new guest' })}
                  </Button>
                </div>
              )}

              {(guestModalMode === 'create' || guestModalMode === 'manage-create' || guestModalMode === 'add-deck' || guests.length === 0) && (
                <div className="space-y-4">
                  {guests.length > 0 && guestModalMode !== 'add-deck' && guestModalMode !== 'manage-create' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="px-0 text-muted-foreground"
                      onClick={() => setGuestModalMode('pick-existing')}
                    >
                      {t({ it: 'Torna ai guest esistenti', en: 'Back to existing guests' })}
                    </Button>
                  )}
                  {guests.length > 0 && guestModalMode === 'add-deck' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="px-0 text-muted-foreground"
                      onClick={() => {
                        setGuestDeckTargetId(null);
                        setGuestModalMode('pick-existing');
                      }}
                    >
                      {t({ it: 'Torna ai guest esistenti', en: 'Back to existing guests' })}
                    </Button>
                  )}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      {t({ it: 'Nome guest', en: 'Guest name' })}
                    </label>
                    <Input
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      placeholder={t({ it: 'Es. Marco', en: 'e.g. Marco' })}
                      className="bg-background/50 border-border text-foreground"
                      disabled={savingGuest || guestModalMode === 'add-deck'}
                    />
                  </div>
                  <GuestCommanderPicker
                    deckName={guestDeckName}
                    onDeckNameChange={setGuestDeckName}
                    onSelectCommander={setGuestSelectedCommander}
                    selectedCommander={guestSelectedCommander}
                    selectedPartnerCommander={guestSelectedPartnerCommander}
                    onSelectPartnerCommander={setGuestSelectedPartnerCommander}
                    disabled={savingGuest}
                  />
                </div>
              )}
            </CardContent>
            {(guestModalMode === 'create' || guestModalMode === 'manage-create' || guestModalMode === 'add-deck' || guests.length === 0) && (
              <div className="border-t border-border/70 px-6 py-4">
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 border-border text-foreground"
                    onClick={resetGuestModal}
                    disabled={savingGuest}
                  >
                    {t({ it: 'Annulla', en: 'Cancel' })}
                  </Button>
                  <Button
                    className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                    onClick={handleSaveGuestModal}
                    disabled={
                      savingGuest ||
                      !guestSelectedCommander ||
                      (guestModalMode === 'add-deck' ? !guestDeckTargetId : !guestName.trim())
                    }
                  >
                    {savingGuest
                      ? t({ it: 'Salvataggio...', en: 'Saving...' })
                      : guestModalMode === 'add-deck'
                        ? t({ it: 'Salva mazzo', en: 'Save deck' })
                        : t({ it: 'Aggiungi guest', en: 'Add guest' })}
                  </Button>
                </div>
              </div>
            )}
          </ModalCard>
        </ModalOverlay>
      )}
  </>;
}
