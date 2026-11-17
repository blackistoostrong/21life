'use client';

import { ArrowLeft, Check, ChevronRight, CircleDot, Heart, Loader2, RotateCcw, Search, Swords, UserRound, WifiOff } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { DeckImage } from '@/components/deck-image';
import { LayoutMiniature } from '@/components/live-game/layout-miniature';
import { WebJournalWarning } from '@/components/live-game/web-journal-warning';
import { OccasionalDeckForm } from '@/components/arena/occasional-deck-form';
import { matchesLiveGameDeckSearch } from '@/lib/live-game-deck-search';
import { getSquareTableLayouts, getCenterToolbarBand, getSeatRotation } from '@/lib/live-game-table-layout';
import { cn } from '@/lib/utils';
import type { ParticipantKey } from '@/lib/participant-keys';
import type { WebJournalError } from '@/lib/live-game-offline';
import type { WebTrackerSetupController } from '@/hooks/use-web-tracker-setup';

/** Presentation delegates occasional creation to its existing form container. */
export function WebTrackerWizard({ setup, groupId, arenaName, online, journalError, starting,
  deckWizardSearch, onExit, onStart }: {
  setup: WebTrackerSetupController;
  groupId: string;
  arenaName: string;
  online: boolean;
  journalError: WebJournalError | null;
  starting: boolean;
  deckWizardSearch: boolean;
  onExit: () => void;
  onStart: () => void;
}) {
  const { copy } = useLanguage();
  const { participants, occasionalCreationBusy, playerCount, layoutVariant, setLayoutVariant,
    startingLife, setStartingLife, seats, setSeats, setupStep, setSetupStep,
    setupSeatIndex, setSetupSeatIndex, setupDeckSearch, setSetupDeckSearch,
    changePlayerCount, updateSeatParticipant, setOccasionalBusy, registerOccasionalDeck } = setup;
  const usedKeys = seats.map((seat) => seat.participantKey).filter(Boolean);
  const setupLayouts = getSquareTableLayouts(playerCount, 1000, 680, layoutVariant);
  const setupToolbarBand = getCenterToolbarBand(playerCount, 1000, 680, layoutVariant);
  const activeSetupSeat = seats[setupSeatIndex] ?? seats[0];
  const activeSetupParticipant = participants.find((entry) => entry.key === activeSetupSeat?.participantKey);
  const activeSetupDecks = activeSetupParticipant?.decks.filter((deck) => (
    !deckWizardSearch
      ? true
      : matchesLiveGameDeckSearch(deck, setupDeckSearch)
  )) ?? [];
  const setupComplete = seats.length === playerCount
    && seats.every((seat) => Boolean(seat.participantKey && seat.deckId));
  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top,#08100a_0%,#08080e_48%,#000_100%)] px-3 pb-10 pt-[max(1rem,env(safe-area-inset-top))] text-foreground sm:px-6">
      <WebJournalWarning error={journalError} className="mx-auto mb-4 max-w-5xl" />
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label={copy({ it: 'Torna al playgroup', en: 'Back to playgroup' })} onClick={onExit}><ArrowLeft /></Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">Live tracker</p>
            <h1 className="truncate text-2xl font-black">{arenaName}</h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-2 text-xs text-muted-foreground">
            {online ? <CircleDot className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-amber-400" />}
            <span className="hidden sm:inline">{online ? 'Realtime' : copy({ it: 'Non in linea', en: 'Offline' })}</span>
            <span className="sr-only sm:hidden">{online ? 'Realtime' : copy({ it: 'Non in linea', en: 'Offline' })}</span>
          </div>
        </div>

        <div className="rounded-3xl border border-emerald-500/25 bg-card/90 shadow-2xl shadow-emerald-950/30 backdrop-blur-xl">
          <div className="rounded-t-3xl border-b border-border bg-gradient-to-r from-emerald-500/10 to-cyan-500/5 p-5 sm:p-7">
            <h2 className="text-xl font-black">{copy({ it: 'Configura la partita', en: 'Set up the game' })}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{copy({ it: 'Scegli layout, posti e mazzi. L’ultima configurazione viene ricordata.', en: 'Choose layout, seats and decks. Your last setup is remembered.' })}</p>
          </div>
          <div className="flex flex-col gap-7 p-4 sm:p-7">
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3].map((step) => (
                <button
                  key={step}
                  type="button"
                  aria-label={`${copy({ it: 'Passaggio', en: 'Step' })} ${step + 1}`}
                  disabled={occasionalCreationBusy}
                  onClick={() => { if (!occasionalCreationBusy) setSetupStep(step); }}
                  className={cn('h-1.5 flex-1 rounded-full py-3 transition', step <= setupStep ? 'bg-emerald-400 bg-clip-content' : 'bg-white/10 bg-clip-content')}
                />
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={occasionalCreationBusy}
                onClick={() => {
                  if (occasionalCreationBusy) return;
                  setSeats((current) => current.map(() => ({ participantKey: null, deckId: null })));
                  setSetupDeckSearch('');
                }}
              >
                <RotateCcw className="mr-2 h-4 w-4" />{copy({ it: 'Azzera', en: 'Reset' })}
              </Button>
            </div>

            <section className="min-h-[330px] animate-in fade-in slide-in-from-right-2 [@media(max-height:520px)]:min-h-0">
              <div className="mb-5 flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-black shadow-lg shadow-emerald-950/40">{setupStep + 1}</span>
                <div>
                  <h3 className="text-lg font-black">
                    {[
                      copy({ it: 'Quanti giocatori?', en: 'How many players?' }),
                      copy({ it: 'Punti vita iniziali', en: 'Starting life' }),
                      copy({ it: 'Scegli il layout', en: 'Choose the layout' }),
                      copy({ it: 'Assegna i posti', en: 'Assign the seats' }),
                    ][setupStep]}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {[
                      copy({ it: 'Puoi giocare da 2 a 6 persone.', en: 'Play with 2 to 6 people.' }),
                      copy({ it: 'Il totale iniziale vale per tutti.', en: 'The starting total applies to everyone.' }),
                      copy({ it: 'L’anteprima rispecchia il tavolo di gioco.', en: 'The preview matches the game table.' }),
                      copy({ it: 'Tocca un posto e scegli giocatore e mazzo.', en: 'Tap a seat, then choose player and deck.' }),
                    ][setupStep]}
                  </p>
                </div>
              </div>

              {setupStep === 0 ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 sm:gap-4">
                  {[2, 3, 4, 5, 6].map((count) => (
                    <button
                      key={count}
                      onClick={() => changePlayerCount(count)}
                      className={cn(
                        'group relative aspect-square max-h-24 rounded-3xl border text-2xl font-black transition hover:-translate-y-1 active:scale-95',
                        playerCount === count
                          ? 'border-emerald-300 bg-gradient-to-br from-emerald-500/40 to-teal-500/15 text-white shadow-xl shadow-emerald-950/40'
                          : 'border-white/10 bg-white/[.035] text-muted-foreground hover:border-emerald-400/50 hover:text-white',
                      )}
                    >
                      {count}
                      <UserRound className="mx-auto mt-2 h-5 w-5 opacity-55" />
                      {playerCount === count ? <Check className="absolute right-3 top-3 h-4 w-4 text-emerald-200" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {setupStep === 1 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[20, 25, 30, 40, 60].map((life) => (
                    <button
                      key={life}
                      onClick={() => setStartingLife(life)}
                      className={cn(
                        'relative flex h-16 items-center justify-center rounded-3xl border text-2xl font-black transition hover:-translate-y-1 active:scale-95 sm:h-20',
                        startingLife === life
                          ? 'border-cyan-300 bg-gradient-to-br from-cyan-500/25 to-emerald-500/15 text-cyan-50 shadow-xl shadow-cyan-950/20'
                          : 'border-white/10 bg-white/[.035] text-muted-foreground hover:border-cyan-400/45 hover:text-white',
                      )}
                    >
                      <Heart className="mr-3 h-6 w-6 text-rose-300" />{life}
                      {startingLife === life ? <Check className="absolute right-4 top-4 h-4 w-4 text-cyan-200" /> : null}
                    </button>
                  ))}
                  <label className="flex h-16 items-center gap-3 rounded-3xl border border-white/10 bg-white/[.035] px-4 focus-within:border-cyan-400/60 sm:h-20 sm:px-5">
                    <Heart className="h-6 w-6 text-rose-300" />
                    <span className="sr-only">{copy({ it: 'Punti vita personalizzati', en: 'Custom starting life' })}</span>
                    <input
                      type="number"
                      min={1}
                      value={[20, 25, 30, 40, 60].includes(startingLife) ? '' : startingLife}
                      placeholder={copy({ it: 'Altro', en: 'Custom' })}
                      onChange={(event) => {
                        const value = Number.parseInt(event.target.value, 10);
                        if (Number.isFinite(value) && value > 0) setStartingLife(value);
                      }}
                      className="min-w-0 flex-1 bg-transparent text-xl font-black outline-none placeholder:text-muted-foreground"
                    />
                  </label>
                </div>
              ) : null}

              {setupStep === 2 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {(['classic', 'opposed'] as const).map((variant) => {
                    const title = variant === 'classic'
                      ? copy({ it: 'Intorno al tavolo', en: 'Around the table' })
                      : copy({ it: 'Lati contrapposti', en: 'Opposing sides' });
                    const description = variant === 'classic'
                      ? copy({ it: 'Posti distribuiti in modo uniforme.', en: 'Seats distributed evenly around the table.' })
                      : copy({ it: 'Posti raggruppati sui lati opposti.', en: 'Seats grouped on opposing sides.' });
                    return (
                      <button
                        key={variant}
                        onClick={() => setLayoutVariant(variant)}
                        aria-pressed={layoutVariant === variant}
                        className={cn(
                          'group relative rounded-3xl border p-3 text-left transition hover:-translate-y-1 active:scale-[.98] sm:p-4',
                          layoutVariant === variant
                            ? 'border-emerald-300 bg-emerald-500/15 shadow-xl shadow-emerald-950/30'
                            : 'border-white/10 bg-white/[.035] hover:border-emerald-400/45',
                        )}
                      >
                        <LayoutMiniature
                          playerCount={playerCount}
                          variant={variant}
                          tableLabel={copy({ it: 'centro', en: 'center' })}
                          seatLabel={copy({ it: 'Posto', en: 'Seat' })}
                        />
                        <div className="mt-4 flex items-start gap-3">
                          <span className={cn(
                            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-black transition',
                            layoutVariant === variant
                              ? 'border-emerald-200 bg-emerald-400 text-emerald-950'
                              : 'border-white/15 bg-white/5 text-white/50 group-hover:border-emerald-300/50',
                          )}>
                            {layoutVariant === variant ? <Check className="h-4 w-4" /> : playerCount}
                          </span>
                          <span className="min-w-0">
                            <b className="block text-sm text-foreground sm:text-base">{title}</b>
                            <small className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</small>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {setupStep === 3 ? (
                <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,.72fr)] xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
                  <div
                    className="mx-auto w-full self-center"
                    style={{ maxWidth: 'min(100%, calc(52vh * 25 / 17))' }}
                  >
                  <div className="relative aspect-[25/17] w-full overflow-hidden rounded-3xl border border-emerald-400/20 bg-[radial-gradient(circle_at_center,#0a120c_0%,#08080d_68%)] shadow-inner">
                    <div className="pointer-events-none absolute inset-2 rounded-[1.15rem] border border-emerald-100/[.06]" />
                    {setupToolbarBand ? (
                      <span
                        className="absolute z-[1] grid place-items-center rounded-lg border border-dashed border-amber-200/20 bg-amber-950/20 text-[8px] font-black uppercase tracking-[.2em] text-amber-100/45"
                        style={{
                          left: `${setupToolbarBand.left / 10}%`,
                          top: `${setupToolbarBand.top / 6.8}%`,
                          width: `${setupToolbarBand.width / 10}%`,
                          height: `${setupToolbarBand.height / 6.8}%`,
                        }}
                      >
                        {copy({ it: 'centro tavolo', en: 'table center' })}
                      </span>
                    ) : null}
                    {setupLayouts.map((layout, index) => {
                      const seat = seats[index];
                      const participant = participants.find((entry) => entry.key === seat?.participantKey);
                      const deck = participant?.decks.find((entry) => entry.id === seat?.deckId);
                      return (
                        <button
                          key={index}
                          type="button"
                          disabled={occasionalCreationBusy}
                          onClick={() => { if (occasionalCreationBusy) return; setSetupSeatIndex(index); setSetupDeckSearch(''); }}
                          aria-label={`${copy({ it: 'Posto', en: 'Seat' })} ${index + 1}${participant ? `: ${participant.displayName}` : ''}`}
                          aria-pressed={setupSeatIndex === index}
                          className={cn(
                            'group absolute overflow-hidden rounded-xl border p-1.5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 active:scale-[.98] sm:p-2',
                            setupSeatIndex === index
                              ? 'z-10 border-emerald-200 bg-emerald-500/25 ring-4 ring-emerald-500/20'
                              : 'border-dashed border-emerald-300/35 bg-emerald-500/10 hover:border-emerald-300/70',
                          )}
                          style={{ left: `${layout.left / 10}%`, top: `${layout.top / 6.8}%`, width: `${layout.width / 10}%`, height: `${layout.height / 6.8}%` }}
                        >
                          {deck?.commanderImage ? <DeckImage src={deck.commanderImage} alt="" className="absolute inset-0 h-full w-full rounded-none object-cover opacity-30 transition group-hover:opacity-40" fallbackClassName="hidden" /> : null}
                          <span className="absolute left-1.5 top-1.5 z-[1] grid h-5 min-w-5 place-items-center rounded-md border border-emerald-100/25 bg-black/65 px-1 text-[9px] font-black text-emerald-100 sm:left-2 sm:top-2 sm:h-6 sm:min-w-6 sm:text-[10px]">
                            {index + 1}
                          </span>
                          <span className="relative flex h-full min-h-0 flex-col items-center justify-center px-1">
                            <UserRound className={cn('mb-1 h-4 w-4 text-emerald-200/70', participant && 'hidden')} />
                            <b className="block max-w-full truncate text-[10px] leading-tight text-white sm:text-sm">{participant?.displayName ?? copy({ it: 'Scegli', en: 'Choose' })}</b>
                            {deck ? <small className="mt-0.5 hidden max-w-full truncate text-[9px] text-white/70 sm:block">{deck.commander}</small> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                    <p className="mb-3 text-xs font-black uppercase tracking-[.18em] text-emerald-300">{copy({ it: 'Posto', en: 'Seat' })} {setupSeatIndex + 1}</p>
                    <select
                      data-testid="live-player-select"
                      disabled={occasionalCreationBusy}
                        aria-label={copy({ it: 'Scegli giocatore', en: 'Choose player' })}
                      value={activeSetupSeat?.participantKey ?? ''}
                      onChange={(event) => updateSeatParticipant(setupSeatIndex, (event.target.value || null) as ParticipantKey | null)}
                      className="h-12 w-full rounded-xl border border-input bg-card px-3 font-semibold outline-none focus:border-emerald-400"
                    >
                      <option value="">{copy({ it: 'Scegli giocatore', en: 'Choose player' })}</option>
                      {participants.map((entry) => (
                        <option key={entry.key} value={entry.key} disabled={usedKeys.includes(entry.key) && entry.key !== activeSetupSeat?.participantKey}>{entry.displayName}</option>
                      ))}
                    </select>
                    {activeSetupParticipant ? (
                      <div className="mt-3 space-y-3">
                        {!activeSetupParticipant.isGuest && activeSetupParticipant.userId && <OccasionalDeckForm
                          key={`${activeSetupParticipant.key}:${activeSetupSeat?.deckId || ''}`} groupId={groupId} userId={activeSetupParticipant.userId} disabled={occasionalCreationBusy} onBusyChange={busy => setOccasionalBusy(activeSetupParticipant.key, busy)}
                          onCreated={deck => registerOccasionalDeck(setupSeatIndex, activeSetupParticipant.key, deck)} />}
                        {deckWizardSearch ? (
                          <label className="relative block">
                            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                            <input
                              value={setupDeckSearch}
                              onChange={(event) => setSetupDeckSearch(event.target.value)}
                              placeholder={copy({ it: 'Cerca mazzo o comandante', en: 'Search deck or commander' })}
                              className="h-11 w-full rounded-xl border border-input bg-card pl-10 pr-3 text-sm outline-none focus:border-emerald-400"
                            />
                          </label>
                        ) : null}
                        <div className="flex gap-2 overflow-x-auto pb-2">
                        {activeSetupDecks.map((deck) => {
                          const selected = activeSetupSeat?.deckId === deck.id;
                          return (
                            <button
                              data-testid="live-deck-option"
                              disabled={occasionalCreationBusy}
                              key={deck.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => { if (!occasionalCreationBusy) setSeats((current) => current.map((item, index) => index === setupSeatIndex ? { ...item, deckId: deck.id } : item)); }}
                              className={cn('w-24 shrink-0 overflow-hidden rounded-xl border bg-card text-left transition active:scale-[.98]', selected ? 'border-emerald-300 ring-2 ring-emerald-500/25' : 'border-white/10')}
                            >
                              <DeckImage src={deck.commanderImage} alt={deck.commander} className="h-24 w-full rounded-none object-cover object-top" fallbackClassName="h-24 w-full rounded-none" />
                              <b className="line-clamp-2 p-2 text-[10px] leading-tight">{deck.commander}</b>
                            </button>
                          );
                        })}
                        {activeSetupDecks.length === 0 ? (
                          <p className="py-5 text-sm text-muted-foreground">{copy({ it: 'Nessun mazzo corrispondente.', en: 'No matching decks.' })}</p>
                        ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>

            <div className="sticky bottom-0 z-20 -mx-4 -mb-4 flex flex-col-reverse gap-3 rounded-b-3xl border-t border-border bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:-mx-7 sm:-mb-7 sm:flex-row sm:px-7 sm:pb-[max(1.75rem,env(safe-area-inset-bottom))]">
              {setupStep > 0 ? <Button disabled={occasionalCreationBusy} variant="outline" onClick={() => setSetupStep((step) => step - 1)} className="w-full sm:w-auto"><ArrowLeft className="mr-2 h-4 w-4" />{copy({ it: 'Indietro', en: 'Back' })}</Button> : <span className="hidden flex-1 sm:block" />}
              {setupStep < 3 ? (
                <Button disabled={occasionalCreationBusy} onClick={() => setSetupStep((step) => step + 1)} className="h-12 w-full bg-gradient-to-r from-emerald-600 to-teal-600 px-7 font-black shadow-lg shadow-emerald-950/40 sm:ml-auto sm:w-auto">
                  {copy({ it: 'Avanti', en: 'Next' })}<ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button data-testid="live-start" onClick={onStart} disabled={starting || occasionalCreationBusy || !setupComplete} className="h-12 w-full bg-gradient-to-r from-emerald-600 to-teal-600 px-5 font-black shadow-lg shadow-emerald-950/40 sm:ml-auto sm:w-auto sm:px-8">
                  {starting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Swords className="mr-2 h-5 w-5" />}
                  {setupComplete ? copy({ it: 'Avvia partita', en: 'Start game' }) : copy({ it: 'Completa tutti i posti', en: 'Complete every seat' })}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
