'use client';
import type { Dispatch, SetStateAction } from 'react';
import type { useArenaMatchCreation } from '@/hooks/use-arena-match-creation';
import type { useArenaGuestCommands } from '@/hooks/use-arena-guest-commands';
import type { Profile, Deck } from '@/lib/types/arena-catalog';
import type { ArenaGuest, ArenaGuestDeck } from '@/lib/arena-participants';
import { toUserParticipantKey, parseParticipantKey, type ParticipantKey } from '@/lib/participant-keys';
import { getProfileDisplayName } from '@/lib/profile-display';
import type { WinCondition } from '@/packages/domain/live-game-types';
import { useLanguage } from '@/components/language-provider';
import { ModalOverlay, ModalCard } from '@/components/ui/modal-shell';
import { CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { MatchParticipantRow, toDeckOption } from '@/components/arena/match-participant-row';
import { OccasionalDeckForm } from '@/components/arena/occasional-deck-form';
import { UserPlus } from 'lucide-react';

type Props = {
  groupId: string; members: Profile[]; guests: ArenaGuest[]; form: ReturnType<typeof useArenaMatchCreation>;
  anyOccasionalCreationBusy: boolean;
  setOccasionalCreationBusy: Dispatch<SetStateAction<Record<string, boolean>>>;
  setOccasionalChoices: Dispatch<SetStateAction<Deck[]>>;
  openGuestModal: ReturnType<typeof useArenaGuestCommands>['openGuestModal'];
  getParticipantDeckOptions: (key: ParticipantKey) => Array<Deck | ArenaGuestDeck>;
  getFilteredParticipantDeckOptions: (key: ParticipantKey, searches: Record<string, string>) => Array<Deck | ArenaGuestDeck>;
  getSelectedParticipantDeck: (key: ParticipantKey) => Deck | ArenaGuestDeck | null;
};
/** Present the existing creation form; commands and drafts belong to its owner. */
export function ArenaMatchCreateDialog({ groupId, members, guests, form, anyOccasionalCreationBusy,
  setOccasionalCreationBusy, setOccasionalChoices, openGuestModal, getParticipantDeckOptions,
  getFilteredParticipantDeckOptions, getSelectedParticipantDeck }: Props) {
  const { copy: t } = useLanguage();
  const { showMatchModal, selectedParticipantKeys, participantDecks, participantDeckSearches, hiddenParticipantDeckLists, winnerKey, matchIsDraw, matchWinCondition, matchNotes, matchPlayedAt, savingMatch, setParticipantDeckSearches, setHiddenParticipantDeckLists, setParticipantDecks, toggleParticipantSelection, setMatchIsDraw, setWinnerKey, setMatchWinCondition, setMatchPlayedAt, setMatchNotes, resetMatchForm, handleCreateMatch } = form;
  return <>{showMatchModal && (
        <ModalOverlay>
          <ModalCard size="xl">
            <CardHeader className="shrink-0 border-b border-border/70">
              <CardTitle className="text-foreground">{t({ it: 'Registra partita', en: 'Record Battle' })}</CardTitle>
              <CardDescription className="text-muted-foreground">{t({ it: 'Seleziona partecipanti e vincitore', en: 'Select combatants and the victor' })}</CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto py-6">
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-medium text-foreground mb-3 block">{t({ it: 'Partecipanti', en: 'Combatants' })}</label>
                  <div className="space-y-2">
                    {members.map((member) => {
                      const participantKey = toUserParticipantKey(member.id);
                      const deckOptions = getParticipantDeckOptions(participantKey).map(toDeckOption);
                      const filteredDeckOptions = getFilteredParticipantDeckOptions(participantKey, participantDeckSearches).map(toDeckOption);
                      const selectedDeck = getSelectedParticipantDeck(participantKey);

                      return (
                        <div key={participantKey}>
                        <MatchParticipantRow
                          participantKey={participantKey}
                          displayName={getProfileDisplayName(member)}
                          deckCount={deckOptions.length}
                          selected={selectedParticipantKeys.includes(participantKey)}
                          selectedDeck={selectedDeck ? toDeckOption(selectedDeck) : null}
                          deckListHidden={Boolean(hiddenParticipantDeckLists[participantKey])}
                          searchValue={participantDeckSearches[participantKey] || ''}
                          selectedDeckId={participantDecks[participantKey] || ''}
                          filteredDecks={filteredDeckOptions}
                          onToggle={() => toggleParticipantSelection(participantKey)}
                          onSearchChange={(value) => setParticipantDeckSearches((prev) => ({ ...prev, [participantKey]: value }))}
                          onToggleDeckList={() => setHiddenParticipantDeckLists((prev) => ({ ...prev, [participantKey]: !prev[participantKey] }))}
                          onSelectDeck={(deckId) => { if (!anyOccasionalCreationBusy) setParticipantDecks((prev) => ({ ...prev, [participantKey]: deckId })); }}

                        />
                        {selectedParticipantKeys.includes(participantKey) && <OccasionalDeckForm key={`${participantKey}:${participantDecks[participantKey] || ''}`} groupId={groupId} userId={member.id} disabled={anyOccasionalCreationBusy} onBusyChange={busy => setOccasionalCreationBusy(current => ({ ...current, [participantKey]: busy }))} onCreated={(deck) => {
                          setOccasionalChoices(current => [...current.filter(item => item.id !== deck.id), deck as Deck]);
                          setParticipantDecks(current => ({ ...current, [participantKey]: deck.id }));
                        }} />}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label className="text-sm font-medium text-foreground">{t({ it: 'Guest', en: 'Guests' })}</label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-border text-foreground"
                      onClick={() => {
                        openGuestModal(guests.length > 0 ? 'pick-existing' : 'create');
                      }}
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      {t({ it: 'Aggiungi guest', en: 'Add guest' })}
                    </Button>
                  </div>
                  {selectedParticipantKeys.filter((key) => key.startsWith('guest:')).length === 0 ? (
                    <p className="rounded-lg border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
                      {t({ it: 'Nessun guest selezionato. Aggiungi un guest per includerlo nella partita.', en: 'No guests selected. Add a guest to include them in this battle.' })}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedParticipantKeys
                        .filter((key) => key.startsWith('guest:'))
                        .map((participantKey) => {
                          const parsed = parseParticipantKey(participantKey);
                          const guest = guests.find((entry) => entry.id === parsed?.id);
                          const deckOptions = getParticipantDeckOptions(participantKey).map(toDeckOption);
                          const filteredDeckOptions = getFilteredParticipantDeckOptions(participantKey, participantDeckSearches).map(toDeckOption);
                          const selectedDeck = getSelectedParticipantDeck(participantKey);

                          return (
                            <MatchParticipantRow
                              key={participantKey}
                              participantKey={participantKey}
                              displayName={guest?.display_name || t({ it: 'Guest', en: 'Guest' })}
                              isGuest
                              deckCount={deckOptions.length}
                              selected
                              selectedDeck={selectedDeck ? toDeckOption(selectedDeck) : null}
                              deckListHidden={Boolean(hiddenParticipantDeckLists[participantKey])}
                              searchValue={participantDeckSearches[participantKey] || ''}
                              selectedDeckId={participantDecks[participantKey] || ''}
                              filteredDecks={filteredDeckOptions}
                              onToggle={() => toggleParticipantSelection(participantKey)}
                              onSearchChange={(value) => setParticipantDeckSearches((prev) => ({ ...prev, [participantKey]: value }))}
                              onToggleDeckList={() => setHiddenParticipantDeckLists((prev) => ({ ...prev, [participantKey]: !prev[participantKey] }))}
                              onSelectDeck={(deckId) => { if (!anyOccasionalCreationBusy) setParticipantDecks((prev) => ({ ...prev, [participantKey]: deckId })); }}

                            />
                          );
                        })}
                    </div>
                  )}
                </div>

                {selectedParticipantKeys.length >= 2 && (
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Checkbox
                        checked={matchIsDraw}
                        onCheckedChange={(checked) => {
                          const isDraw = checked === true;
                          setMatchIsDraw(isDraw);
                          if (isDraw) setWinnerKey('');
                        }}
                      />
                      {t({ it: 'Patta', en: 'Draw' })}
                    </label>
                    {!matchIsDraw ? (
                    <div>
                    <label className="text-sm font-medium text-foreground mb-3 block">{t({ it: 'Vincitore', en: 'Victor' })}</label>
                    <Select value={winnerKey} onValueChange={(value) => setWinnerKey(value as ParticipantKey)}>
                      <SelectTrigger className="w-full bg-background border-border text-foreground"><SelectValue placeholder={t({ it: 'Seleziona il vincitore', en: 'Select the victor' })} /></SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {selectedParticipantKeys.map((participantKey) => {
                          const parsed = parseParticipantKey(participantKey);
                          const displayName = parsed?.type === 'guest'
                            ? guests.find((entry) => entry.id === parsed.id)?.display_name || t({ it: 'Guest', en: 'Guest' })
                            : getProfileDisplayName(members.find((member) => member.id === parsed?.id));
                          const selectedDeck = getSelectedParticipantDeck(participantKey);
                          return (
                            <SelectItem key={participantKey} value={participantKey}>
                              {displayName}{selectedDeck ? ` (${selectedDeck.commander})` : ''}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <label className="mb-2 mt-4 block text-sm font-medium text-foreground">
                      {t({ it: 'Come ha vinto?', en: 'How did they win?' })}
                    </label>
                    <Select
                      value={matchWinCondition}
                      onValueChange={(value) => setMatchWinCondition(value as WinCondition)}
                    >
                      <SelectTrigger className="w-full border-border bg-background text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-border bg-card">
                        <SelectItem value="last_standing">{t({ it: 'Ultimo in gioco', en: 'Last standing' })}</SelectItem>
                        <SelectItem value="combo">Combo</SelectItem>
                        <SelectItem value="concession">{t({ it: 'Concessione', en: 'Concession' })}</SelectItem>
                        <SelectItem value="alternate_card">{t({ it: 'Vittoria alternativa', en: 'Alternate win' })}</SelectItem>
                        <SelectItem value="other">{t({ it: 'Altro', en: 'Other' })}</SelectItem>
                      </SelectContent>
                    </Select>
                    </div>
                    ) : null}
                  </div>
                )}
                <div>
                  <label htmlFor="match-played-at" className="text-sm font-medium text-foreground mb-2 block">
                    {t({ it: 'Data', en: 'Date' })}
                  </label>
                  <Input
                    id="match-played-at"
                    type="date"
                    value={matchPlayedAt}
                    onChange={(e) => setMatchPlayedAt(e.target.value)}
                    className="bg-background/50 border-border text-foreground"
                  />
                </div>
                <RichTextEditor
                  label={t({ it: 'Note (opzionali)', en: 'Notes (optional)' })}
                  value={matchNotes}
                  onChange={setMatchNotes}
                  placeholder={t({ it: 'Cronaca della partita...', en: 'Epic saga of the battle...' })}
                  hint={t({
                    it: 'Usa la barra formato per grassetto, corsivo, barrato, a capo ed elenchi.',
                    en: 'Use the format toolbar for bold, italic, strike, line breaks, and bullet lists.',
                  })}
                  minRows={3}
                />
              </div>
            </CardContent>
            <div className="shrink-0 border-t border-border/70 bg-card px-6 py-4">
              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={resetMatchForm} disabled={anyOccasionalCreationBusy} className="flex-1 border-border text-foreground">{t({ it: 'Annulla', en: 'Cancel' })}</Button>
                <Button onClick={handleCreateMatch} disabled={savingMatch || anyOccasionalCreationBusy} className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700">
                  {savingMatch ? t({ it: 'Registrazione...', en: 'Recording...' }) : t({ it: 'Registra partita', en: 'Record Battle' })}
                </Button>
              </div>
            </div>
          </ModalCard>
        </ModalOverlay>
      )}</>;
}
