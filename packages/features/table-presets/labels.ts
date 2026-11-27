import type {TablePresetDraft, TablePresetErrorKind} from '../../domain/table-presets';

export function tablePresetLabels(language: 'it' | 'en') {
  const it = language === 'it';
  const errors: Record<TablePresetErrorKind, string> = {
    invalid: it ? 'Preset non leggibili. I dati salvati non sono stati modificati.' : 'Cannot read presets. Stored data has not been changed.',
    unsupported: it ? 'Preset di una versione più recente. Aggiorna l’app; i dati sono conservati.' : 'Presets use a newer version. Update the app; stored data is preserved.',
    scope: it ? 'Account o playgroup non più disponibile.' : 'Account or playgroup is no longer available.',
    name: it ? 'Nome richiesto: da 1 a 40 caratteri, senza caratteri di controllo.' : 'Enter a name of 1–40 characters, without control characters.',
    duplicate: it ? 'Esiste già un preset con questo nome.' : 'A preset with this name already exists.',
    limit: it ? 'Limite di 10 preset raggiunto. Eliminane uno prima di salvarne un altro.' : 'Limit of 10 presets reached. Delete one before saving another.',
    not_found: it ? 'Preset non più disponibile. Aggiorna la lista.' : 'Preset is no longer available. Refresh the list.',
    storage: it ? 'Salvataggio locale non disponibile. La configurazione corrente è conservata.' : 'Local storage is unavailable. Your current setup is preserved.',
    cancelled: it ? 'Operazione annullata.' : 'Operation cancelled.',
    references: it ? 'Impossibile verificare giocatori e mazzi. Controlla la connessione e riprova.' : 'Cannot verify players and decks. Check your connection and retry.',
    changed: it ? 'La configurazione salvata è cambiata. Controlla e conferma di nuovo.' : 'The saved setup has changed. Review and confirm again.',
  };
  return {
    title: it ? 'Preset del tavolo' : 'Table presets',
    browserHint: it ? 'Salvati solo in questo browser, per questo account e playgroup.' : 'Saved only in this browser, for this account and playgroup.',
    deviceHint: it ? 'Salvati solo su questo dispositivo, per questo account e playgroup.' : 'Saved only on this device, for this account and playgroup.',
    name: it ? 'Nome preset' : 'Preset name',
    save: it ? 'Salva configurazione attuale' : 'Save current setup',
    load: it ? 'Carica' : 'Load', rename: it ? 'Rinomina' : 'Rename',
    remove: it ? 'Elimina' : 'Delete', confirmRemove: it ? 'Conferma eliminazione' : 'Confirm deletion',
    removeQuestion: (name: string) => it ? `Eliminare “${name}”?` : `Delete “${name}”?`,
    cancel: it ? 'Annulla' : 'Cancel', close: it ? 'Chiudi' : 'Close',
    retry: it ? 'Aggiorna lista' : 'Refresh list',
    empty: it ? 'Nessun preset salvato.' : 'No saved presets.',
    working: it ? 'Operazione in corso…' : 'Working…',
    preview: it ? 'Conferma caricamento' : 'Confirm loading',
    previewHint: it ? 'Giocatori e mazzi saranno verificati. La configurazione attuale verrà sostituita; la partita non verrà avviata.' : 'Players and decks will be verified. Your current setup will be replaced; the game will not start.',
    apply: it ? 'Applica al setup' : 'Apply to setup',
    selectedPlayer: it ? 'Giocatore da verificare' : 'Player to verify',
    selectedDeck: it ? 'Mazzo da verificare' : 'Deck to verify',
    emptySeat: it ? 'Da scegliere' : 'Choose a player',
    missingDeck: it ? 'Mazzo da scegliere' : 'Choose a deck',
    seat: it ? 'Posto' : 'Seat',
    missing: (count: number) => it ? `${count} posti incompleti: controlla giocatori e mazzi mancanti o archiviati prima di iniziare.` : `${count} incomplete seats: review missing or archived players and decks before starting.`,
    summary: (draft: TablePresetDraft) => `${draft.playerCount} ${it ? 'giocatori' : 'players'} · ${draft.startingLife} ${it ? 'vite' : 'life'} · ${draft.layoutVariant === 'opposed' ? (it ? 'opposto' : 'opposed') : (it ? 'classico' : 'classic')}`,
    errors,
  };
}
