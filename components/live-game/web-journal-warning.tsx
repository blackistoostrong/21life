'use client';

import { useLanguage } from '@/components/language-provider';
import type { WebJournalError } from '@/lib/live-game-offline';

export function WebJournalWarning({ error, className = '' }: { error: WebJournalError | null; className?: string }) {
  const { copy } = useLanguage();
  if (!error) return null;
  const messages = {
    unavailable: { it: 'Salvataggio locale non disponibile. Le modifiche restano in memoria fino alla conferma del server: non chiudere questa pagina.', en: 'Local saving unavailable. Changes remain in memory until server confirmation: keep this page open.' },
    ownership: { it: 'Un salvataggio precedente non ha una proprietà verificabile per questo account. È conservato: accedi con l’account che ha creato la partita per recuperarlo.', en: 'An earlier save has no verified owner for this account. It is preserved: sign in with the account that created the game to recover it.' },
    future: { it: 'Salvataggio di un’altra versione conservato. Usa una versione compatibile dell’app per recuperarlo.', en: 'A save from another version is preserved. Use a compatible app version to recover it.' },
    invalid: { it: 'Salvataggio locale non leggibile, conservato per il recupero. Non cancellare i dati del browser; contatta l’assistenza.', en: 'Unreadable local save preserved for recovery. Keep browser data and contact support.' },
    pending_game: { it: 'Una partita precedente attende sincronizzazione. Il suo salvataggio è conservato: recuperala prima di sostituirla.', en: 'An earlier game awaits synchronization. Its save is preserved: recover it before replacing it.' },
  };
  return <div role="status" aria-live="polite" data-testid="live-journal-warning" className={`rounded-xl border border-amber-400/50 bg-zinc-950/95 p-3 text-xs leading-relaxed text-amber-100 ${className}`}>{copy(messages[error])}</div>;
}
