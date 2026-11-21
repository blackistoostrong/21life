'use client';

import { useState } from 'react';
import { Trophy, Clock3, RotateCcw, Swords, Loader2 } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';
import { LiveGameModalTitle } from '@/components/live-game/live-game-modal-title';
import { LiveGameRecapView } from '@/components/live-game/live-game-recap';
import { WebJournalWarning } from '@/components/live-game/web-journal-warning';
import type { LiveGameRecord } from '@/lib/live-game';
import type { WebJournalError } from '@/lib/live-game-offline';
import type { WebLiveGameSetup } from '@/lib/live-game-setup';
import type { TableLayoutVariant } from '@/lib/live-game-table-layout';

/** Owns the recap confirmation UI; session creation/persistence belong to its caller. */
export function WebCompletedGame({ record, duration, arenaName, journalError, starting, onReselect, onRematch, onBack }: {
  record: LiveGameRecord;
  duration: string;
  arenaName: string;
  journalError: WebJournalError | null;
  starting: boolean;
  onReselect: (setup: WebLiveGameSetup) => void;
  onRematch: (setup: WebLiveGameSetup) => void;
  onBack: () => void;
}) {
  const { copy } = useLanguage();
  const [confirmRematch, setConfirmRematch] = useState(false);
  const completedPlayers = [...record.state.players].sort((left, right) => left.slot - right.slot);
  const previousSetup = {
    playerCount: completedPlayers.length,
    layoutVariant: record.state.layoutVariant ?? 'classic' as TableLayoutVariant,
    startingLife: record.starting_life,
    seats: completedPlayers.map((player) => ({
      participantKey: player.participantKey,
      deckId: player.deckId,
    })),
  };
  const prepareReselection = () => {
    onReselect(previousSetup);
  };
  return (
    <div className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_top,#0a1a0d_0%,#08080e_52%,#000_100%)] p-4 text-foreground">
      <WebJournalWarning error={journalError} />
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-400/30 bg-card/95 shadow-2xl shadow-emerald-950/50 backdrop-blur-xl">
        <div className="bg-gradient-to-br from-emerald-600/30 via-teal-600/15 to-transparent p-7 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-200 shadow-lg">
            <Trophy className="h-8 w-8" />
          </div>
          <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-300">{arenaName}</p>
          <h1 className="mt-2 text-3xl font-black">{copy({ it: 'Partita salvata', en: 'Game saved' })}</h1>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-4 py-2 font-bold text-emerald-100">
            <Clock3 className="h-4 w-4" /> {duration}
          </div>
        </div>
        <div className="space-y-3 p-5 sm:p-7">
          <LiveGameRecapView
            record={record}
            labels={{
              timeline: copy({ it: 'Stato finale', en: 'Final state' }),
              highlights: copy({ it: 'Momenti chiave', en: 'Highlights' }),
              empty: copy({ it: 'Nessun momento chiave registrato.', en: 'No highlights recorded.' }),
            }}
          />
          <Button onClick={() => setConfirmRematch(true)} className="h-14 w-full bg-gradient-to-r from-emerald-600 to-teal-600 font-black">
            <RotateCcw className="mr-2 h-5 w-5" />
            {copy({ it: 'Nuova partita · stessi mazzi', en: 'New game · same decks' })}
          </Button>
          <Button variant="outline" onClick={prepareReselection} className="h-14 w-full font-bold">
            <Swords className="mr-2 h-5 w-5" />
            {copy({ it: 'Riseleziona giocatori e mazzi', en: 'Reselect players and decks' })}
          </Button>
          <Button variant="ghost" onClick={onBack} className="w-full text-muted-foreground">
            {copy({ it: 'Torna all’Arena', en: 'Back to Arena' })}
          </Button>
        </div>
      </div>

      {confirmRematch && (
        <ModalOverlay>
          <ModalCard>
            <LiveGameModalTitle icon={RotateCcw} title={copy({ it: 'Confermi gli stessi mazzi?', en: 'Use the same decks?' })} onClose={() => setConfirmRematch(false)} />
            <div className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">
                {copy({
                  it: 'Posti e mazzi restano invariati. Giocatore iniziale e verso di gioco verranno sorteggiati di nuovo.',
                  en: 'Seats and decks stay the same. Starting player and play direction will be randomized again.',
                })}
              </p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setConfirmRematch(false)} className="flex-1">{copy({ it: 'Annulla', en: 'Cancel' })}</Button>
                <Button
                  disabled={starting}
                  onClick={() => {
                    setConfirmRematch(false);
                    onRematch(previousSetup);
                  }}
                  className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 font-black"
                >
                  {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {copy({ it: 'Conferma', en: 'Confirm' })}
                </Button>
              </div>
            </div>
          </ModalCard>
        </ModalOverlay>
      )}
    </div>
  );
}
