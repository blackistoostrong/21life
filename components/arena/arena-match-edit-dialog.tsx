'use client';
import type { Dispatch, SetStateAction } from 'react';
import type { useArenaMatchEditor } from '@/hooks/use-arena-match-editor';
import type { WinCondition } from '@/packages/domain/live-game-types';
import { useLanguage } from '@/components/language-provider';
import type { Deck } from '@/lib/types/arena-catalog';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DeckImage } from '@/components/deck-image';
import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Checkbox } from '@/components/ui/checkbox';
import { OccasionalDeckForm } from '@/components/arena/occasional-deck-form';
import { toDeckOption } from '@/components/arena/match-participant-row';
import { BracketBadge } from '@/components/deck/bracket-badge';
import { getParticipantDisplayName, getParticipantKey } from '@/lib/arena-participants';
import { parseParticipantKey, type ParticipantKey } from '@/lib/participant-keys';
import { Pencil, Search, Eye, EyeOff } from 'lucide-react';

type Props = Pick<Parameters<typeof useArenaMatchEditor>[0], 'groupId' | 'canManageGroup' | 'anyOccasionalCreationBusy'
  | 'setOccasionalChoices' | 'getParticipantDeckOptions'> & {
  form: ReturnType<typeof useArenaMatchEditor>;
  setOccasionalCreationBusy: Dispatch<SetStateAction<Record<string, boolean>>>;
};
/** Present historical editing; the feature owner owns its draft and command. */
export function ArenaMatchEditDialog({ groupId, canManageGroup, anyOccasionalCreationBusy, setOccasionalChoices,
  getParticipantDeckOptions, setOccasionalCreationBusy, form }: Props) {
  const { copy: t } = useLanguage();
  const {
    editingMatch,
    setEditingMatch,
    editMatchWinnerKey,
    setEditMatchWinnerKey,
    editMatchIsDraw,
    setEditMatchIsDraw,
    editMatchWinCondition,
    setEditMatchWinCondition,
    editMatchNotes,
    setEditMatchNotes,
    editMatchPlayedAt,
    setEditMatchPlayedAt,
    editMatchPlayerKeys,
    setEditMatchPlayerKeys,
    editMatchPlayerDecks,
    setEditMatchPlayerDecks,
    editMatchDeckSearches,
    setEditMatchDeckSearches,
    hiddenEditMatchDeckLists,
    setHiddenEditMatchDeckLists,
    savingEditMatch,
    editMatchPlayerOptions,
    getFilteredEditMatchDeckOptions,
    getSelectedEditMatchDeck,
    handleSaveEditMatch,
  } = form;
  return <>{editingMatch && (
        <ModalOverlay>
          <ModalCard size="xl">
            <CardHeader className="shrink-0 border-b border-border/70">
              <CardTitle className="text-foreground flex items-center gap-2">
                <Pencil className="w-5 h-5" /> {t({ it: 'Modifica partita', en: 'Edit Battle' })}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t({ it: 'Aggiorna data, mazzi, vincitore e note.', en: 'Update date, decks, winner, and notes.' })}
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto py-6">
              <div className="space-y-6">
                <div>
                  <label htmlFor="edit-match-played-at" className="text-sm font-medium text-foreground mb-2 block">
                    {t({ it: 'Data', en: 'Date' })}
                  </label>
                  <Input
                    id="edit-match-played-at"
                    type="date"
                    value={editMatchPlayedAt}
                    onChange={(e) => setEditMatchPlayedAt(e.target.value)}
                    className="bg-background/50 border-border text-foreground"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-3 block">{t({ it: 'Assegnazione mazzi', en: 'Deck Assignments' })}</label>
                  <div className="space-y-3">
                    {editingMatch.match_participants.map((p) => {
                      const participantKey = editMatchPlayerKeys[p.id] || getParticipantKey(p);
                      if (!participantKey) return null;

                      const parsedPlayer = parseParticipantKey(participantKey);
                      const playerLabel = editMatchPlayerOptions.find((option) => option.key === participantKey)?.label
                        || getParticipantDisplayName(p);
                      const deckOptions = getParticipantDeckOptions(participantKey).map(toDeckOption);
                      const filteredDeckOptions = getFilteredEditMatchDeckOptions(p.id, participantKey).map(toDeckOption);
                      const selectedDeck = getSelectedEditMatchDeck(p.id, participantKey);
                      const deckListHidden = hiddenEditMatchDeckLists[p.id];

                      return (
                        <div key={p.id} className="rounded-lg border border-border bg-secondary/30 p-3">
                          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-foreground">{playerLabel}</p>
                                {parsedPlayer?.type === 'guest' && (
                                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                                    Guest
                                  </span>
                                )}
                                {deckOptions.length > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    ({deckOptions.length} {t({ it: deckOptions.length === 1 ? 'mazzo' : 'mazzi', en: deckOptions.length === 1 ? 'deck' : 'decks' })})
                                  </span>
                                )}
                              </div>
                              {selectedDeck && (
                                <p className="mt-1 truncate text-xs text-emerald-300">
                                  {selectedDeck.name} - {selectedDeck.commander}
                                </p>
                              )}
                            </div>

                            {deckOptions.length > 0 && (
                              <div className="flex flex-col gap-2 sm:min-w-80 sm:flex-row sm:items-center">
                                <div className="relative flex-1">
                                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                  <Input
                                    value={editMatchDeckSearches[p.id] || ''}
                                    onChange={(event) => setEditMatchDeckSearches((prev) => ({ ...prev, [p.id]: event.target.value }))}
                                    placeholder={t({ it: 'Cerca mazzo...', en: 'Search deck...' })}
                                    className="h-9 bg-background/50 border-border pl-9 text-foreground placeholder:text-muted-foreground"
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="shrink-0 border-border text-foreground"
                                  onClick={() => setHiddenEditMatchDeckLists((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                                >
                                  {deckListHidden ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                                  {deckListHidden ? t({ it: 'Mostra', en: 'Show' }) : t({ it: 'Nascondi', en: 'Hide' })}
                                </Button>
                              </div>
                            )}
                          </div>

                          {canManageGroup ? (
                            <div className="mb-3 space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">{t({ it: 'Giocatore', en: 'Player' })}</label>
                              <Select
                                value={participantKey}
                                disabled={anyOccasionalCreationBusy}
                                onValueChange={(value) => {
                                  const nextKey = value as ParticipantKey;
                                  const previousKey = editMatchPlayerKeys[p.id] || getParticipantKey(p);
                                  setEditMatchPlayerKeys((current) => ({ ...current, [p.id]: nextKey }));
                                  setEditMatchPlayerDecks((current) => ({ ...current, [p.id]: '' }));
                                  setEditMatchDeckSearches((current) => ({ ...current, [p.id]: '' }));
                                  setHiddenEditMatchDeckLists((current) => ({ ...current, [p.id]: false }));
                                  if (previousKey && editMatchWinnerKey === previousKey) setEditMatchWinnerKey(nextKey);
                                }}
                              >
                                <SelectTrigger className="h-9 w-full bg-background/50 border-border text-foreground">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-card border-border">
                                  {editMatchPlayerOptions.map((option) => (
                                    <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}

                          {parsedPlayer?.type === 'user' && <OccasionalDeckForm key={`${participantKey}:${editMatchPlayerDecks[p.id] || ''}`} groupId={groupId} userId={parsedPlayer.id} disabled={anyOccasionalCreationBusy} onBusyChange={busy => setOccasionalCreationBusy(current => ({ ...current, [p.id]: busy }))} onCreated={(deck) => {
                            setOccasionalChoices(current => [...current.filter(item => item.id !== deck.id), deck as Deck]);
                            setEditMatchPlayerDecks(current => ({ ...current, [p.id]: deck.id }));
                          }} />}

                          {deckOptions.length > 0 ? (
                            deckListHidden ? (
                              <div className="rounded-lg border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
                                {selectedDeck
                                  ? t({ it: 'Lista mazzi nascosta. Il mazzo selezionato resta assegnato.', en: 'Deck list hidden. The selected deck stays assigned.' })
                                  : t({ it: 'Lista mazzi nascosta. Nessun mazzo selezionato.', en: 'Deck list hidden. No deck selected.' })}
                              </div>
                            ) : (
                              <>
                                <div className="grid grid-cols-1 gap-3 sm:grid-flow-col sm:auto-cols-[minmax(290px,320px)] sm:overflow-x-auto sm:pb-3">
                                  <button
                                    type="button"
                                    disabled={anyOccasionalCreationBusy}
                                    onClick={() => { if (!anyOccasionalCreationBusy) setEditMatchPlayerDecks((prev) => ({ ...prev, [p.id]: '' })); }}
                                    className={`h-28 rounded-lg border p-3 text-left text-xs transition-colors ${
                                      !editMatchPlayerDecks[p.id] ? 'border-emerald-500 bg-emerald-500/10' : 'border-border bg-background/25 hover:border-emerald-500/50'
                                    }`}
                                  >
                                    <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border/70 bg-background/25 px-3 text-center">
                                      <span className="text-muted-foreground">{t({ it: 'Nessun mazzo', en: 'No deck' })}</span>
                                    </div>
                                  </button>
                                  {filteredDeckOptions.map((deck) => (
                                    <button
                                      key={deck.id}
                                      type="button"
                                      disabled={anyOccasionalCreationBusy}
                                      onClick={() => { if (!anyOccasionalCreationBusy) setEditMatchPlayerDecks((prev) => ({ ...prev, [p.id]: deck.id })); }}
                                      className={`min-h-[7.5rem] rounded-lg border p-3 text-left transition-colors ${
                                        editMatchPlayerDecks[p.id] === deck.id
                                          ? 'border-emerald-500 bg-emerald-500/10'
                                          : 'border-border bg-background/25 hover:border-emerald-500/50'
                                      }`}
                                    >
                                      <div className="flex h-full items-start gap-3">
                                        <DeckImage
                                          src={deck.commander_image}
                                          alt={deck.commander}
                                          className="h-20 w-24 shrink-0 rounded object-cover object-top"
                                        />
                                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                                          <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{deck.name}</p>
                                          <p className="line-clamp-2 text-xs leading-snug text-emerald-400">{deck.commander}</p>
                                          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1.5">
                                            {deck.source_type && (
                                              <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs ${
                                                deck.source_type === 'archidekt'
                                                  ? 'bg-blue-500/20 text-blue-400'
                                                  : deck.source_type === 'moxfield'
                                                    ? 'bg-teal-500/20 text-teal-300'
                                                    : 'bg-muted text-muted-foreground'
                                              }`}>
                                                {deck.source_type}
                                              </span>
                                            )}
                                            <BracketBadge bracket={deck.bracket} />
                                          </div>
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                                {filteredDeckOptions.length === 0 && (
                                  <p className="mt-2 rounded-lg border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
                                    {t({ it: 'Nessun mazzo trovato con questa ricerca', en: 'No decks match this search' })}
                                  </p>
                                )}
                              </>
                            )
                          ) : (
                            <p className="text-xs text-muted-foreground">{t({ it: 'Nessun mazzo disponibile per questo giocatore', en: 'No decks available for this player' })}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Checkbox
                      checked={editMatchIsDraw}
                      onCheckedChange={(checked) => {
                        const isDraw = checked === true;
                        setEditMatchIsDraw(isDraw);
                        if (isDraw) setEditMatchWinnerKey('');
                      }}
                    />
                    {t({ it: 'Patta', en: 'Draw' })}
                  </label>
                  {!editMatchIsDraw ? (
                    <div className="space-y-4">
                      <label className="text-sm font-medium text-foreground mb-3 block">{t({ it: 'Vincitore', en: 'Winner' })}</label>
                      <Select value={editMatchWinnerKey} onValueChange={(value) => setEditMatchWinnerKey(value as ParticipantKey)}>
                        <SelectTrigger className="w-full bg-background border-border text-foreground">
                          <SelectValue placeholder={t({ it: 'Seleziona il vincitore', en: 'Select the victor' })} />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {editingMatch.match_participants.map((p) => {
                            const participantKey = editMatchPlayerKeys[p.id] || getParticipantKey(p);
                            if (!participantKey) return null;
                            const selectedDeck = getSelectedEditMatchDeck(p.id, participantKey);
                            const playerLabel = editMatchPlayerOptions.find((option) => option.key === participantKey)?.label || getParticipantDisplayName(p);
                            return (
                              <SelectItem key={p.id} value={participantKey}>
                                {playerLabel}{selectedDeck ? ` (${selectedDeck.commander})` : ''}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <div>
                        <label className="mb-3 block text-sm font-medium text-foreground">{t({ it: 'Tipo di vittoria', en: 'Win condition' })}</label>
                        <Select value={editMatchWinCondition} onValueChange={(value) => setEditMatchWinCondition(value as WinCondition)}>
                          <SelectTrigger className="w-full bg-background border-border text-foreground">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            <SelectItem value="last_standing">{t({ it: 'Ultimo in piedi', en: 'Last standing' })}</SelectItem>
                            <SelectItem value="combo">Combo</SelectItem>
                            <SelectItem value="concession">{t({ it: 'Resa', en: 'Concession' })}</SelectItem>
                            <SelectItem value="alternate_card">{t({ it: 'Vittoria alternativa', en: 'Alternate card' })}</SelectItem>
                            <SelectItem value="other">{t({ it: 'Altro', en: 'Other' })}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : null}
                </div>

                <RichTextEditor
                  label={t({ it: 'Note (opzionali)', en: 'Notes (optional)' })}
                  value={editMatchNotes}
                  onChange={setEditMatchNotes}
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
                <Button
                  type="button"
                  variant="outline"
                  disabled={anyOccasionalCreationBusy}
                  onClick={() => {
                    if (anyOccasionalCreationBusy) return;
                    setEditingMatch(null);
                    setEditMatchDeckSearches({});
                    setHiddenEditMatchDeckLists({});
                  }}
                  className="flex-1 border-border text-foreground"
                >
                  {t({ it: 'Annulla', en: 'Cancel' })}
                </Button>
                <Button
                  onClick={handleSaveEditMatch}
                  disabled={savingEditMatch || anyOccasionalCreationBusy || (!editMatchIsDraw && !editMatchWinnerKey)}
                  className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                >
                  {savingEditMatch ? t({ it: 'Salvataggio...', en: 'Saving...' }) : t({ it: 'Salva modifiche', en: 'Save Changes' })}
                </Button>
              </div>
            </div>
          </ModalCard>
        </ModalOverlay>
      )}</>;
}
