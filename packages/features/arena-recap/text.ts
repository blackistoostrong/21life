import {cleanArenaRecapLabel, type ArenaRecapSummary} from '../../domain/arena-recap';
import type {ArenaRecapPeriod} from '../../domain/arena-recap-period';

export type ArenaRecapPayload = Readonly<{title: string; text: string; filename: string}>;
export function arenaRecapLabels(language: 'it' | 'en') {
  const it = language === 'it';
  return {
    title: it ? 'Riepilogo del playgroup' : 'Playgroup recap',
    open: it ? 'Condividi riepilogo' : 'Share recap',
    period: it ? 'Periodo' : 'Period',
    days7: it ? 'Ultimi 7 giorni' : 'Last 7 days', days30: it ? 'Ultimi 30 giorni' : 'Last 30 days',
    includeNames: it ? 'Includi nomi dei giocatori' : 'Include player names',
    privacy: it ? 'Controlla quali dati del playgroup esportare. I nomi restano anonimi finché non scegli di includerli.' : 'Review what you export from the playgroup. Player names stay anonymous unless you choose to include them.',
    close: it ? 'Chiudi' : 'Close', retry: it ? 'Riprova' : 'Retry',
    loading: it ? 'Preparazione del riepilogo completo…' : 'Preparing the complete recap…',
    share: it ? 'Apri condivisione' : 'Open share sheet', copy: it ? 'Copia testo' : 'Copy text', download: it ? 'Scarica .txt' : 'Download .txt',
    copied: it ? 'Testo copiato.' : 'Text copied.', downloaded: it ? 'Download avviato.' : 'Download started.',
    matches: it ? 'Partite concluse' : 'Completed games', players: it ? 'Giocatori' : 'Players', player: it ? 'Giocatore' : 'Player',
    distinctPlayers: it ? 'Partecipanti distinti' : 'Distinct players',
    wins: it ? 'vittorie' : 'wins', win: it ? 'vittoria' : 'win',
    draws: it ? 'pareggi' : 'draws', draw: it ? 'pareggio' : 'draw',
    unknownResults: it ? 'risultati non disponibili' : 'unavailable results',
    commanders: it ? 'Comandanti più giocati' : 'Most played commanders', appearances: it ? 'presenze' : 'appearances',
    median: it ? 'Durata mediana' : 'Median duration', unavailable: it ? 'Dati non disponibili' : 'Data unavailable',
    missingIdentities: it ? 'Alcune identità storiche non sono disponibili; il numero di persone distinte non è ricostruibile.' : 'Some historical identities are unavailable; the distinct player count cannot be reconstructed.',
    missingCommanders: it ? 'Classifica limitata ai comandanti noti; alcuni dati storici sono mancanti.' : 'Ranking covers known commanders; some historical data is missing.',
    morePlayers: (count: number) => it ? `e altri ${count} giocatori` : `and ${count} more players`,
    errors: {
      unavailable: it ? 'Impossibile preparare un riepilogo completo. Riprova.' : 'Cannot prepare a complete recap. Retry.',
      changed: it ? 'Lo storico è cambiato durante la lettura. Riprova per avere un riepilogo coerente.' : 'History changed while loading. Retry for a consistent recap.',
      forbidden: it ? 'Accesso al playgroup non disponibile.' : 'Playgroup access is unavailable.',
      too_large: it ? 'Troppi dati per creare un riepilogo completo di questo periodo.' : 'Too much data to create a complete recap of this period.',
      share: it ? 'Impossibile aprire la condivisione. Riprova.' : 'Cannot open sharing. Retry.',
      copy: it ? 'Impossibile copiare. Riprova o scarica il testo.' : 'Cannot copy. Retry or download the text.',
      download: it ? 'Impossibile avviare il download.' : 'Cannot start the download.',
    },
  };
}

export function arenaRecapPeriodLabel(period: ArenaRecapPeriod, language: 'it' | 'en'): string {
  const formatter = new Intl.DateTimeFormat(language === 'it' ? 'it-IT' : 'en-US', {dateStyle: 'medium', timeZone: 'UTC'});
  return `${formatter.format(new Date(`${period.firstDay}T00:00:00Z`))} – ${formatter.format(new Date(`${period.lastDay}T00:00:00Z`))} (${period.timeZone})`;
}

export function createArenaRecapPayload(summary: ArenaRecapSummary, period: ArenaRecapPeriod,
  options: {groupName: string; language: 'it' | 'en'; includeNames: boolean}, formatDuration: (seconds: number) => string): ArenaRecapPayload {
  const labels = arenaRecapLabels(options.language), name = cleanArenaRecapLabel(options.groupName) || 'Playgroup';
  const lines = [
    `${name} · 21Life`, `${labels.period}: ${arenaRecapPeriodLabel(period, options.language)}`,
    `${labels.matches}: ${summary.totalMatches}`,
    `${labels.distinctPlayers}: ${summary.distinctPlayers === null ? labels.unavailable : summary.distinctPlayers}`,
    `${summary.wins} ${summary.wins === 1 ? labels.win : labels.wins} · ${summary.draws} ${summary.draws === 1 ? labels.draw : labels.draws}`,
  ];
  if (summary.unknownResults > 0) lines.push(`${labels.unknownResults}: ${summary.unknownResults}`);
  if (summary.identityDataIncomplete) lines.push(labels.missingIdentities);
  if (summary.players.length > 0) {
    lines.push('', `${labels.players}:`);
    for (const player of summary.players.slice(0, 20)) {
      const alias = `${labels.player} ${player.alias}`, displayName = options.includeNames && player.displayName ? player.displayName : alias;
      lines.push(`- ${displayName}: ${player.wins} ${player.wins === 1 ? labels.win : labels.wins}, ${player.draws} ${player.draws === 1 ? labels.draw : labels.draws}`);
    }
    if (summary.players.length > 20) lines.push(labels.morePlayers(summary.players.length - 20));
  }
  lines.push('', `${labels.commanders}:`);
  if (summary.topCommanders.length === 0) lines.push(labels.unavailable);
  for (const commander of summary.topCommanders.slice(0, 3)) lines.push(`- ${commander.commander}: ${commander.appearances} ${labels.appearances}`);
  if (summary.commanderDataIncomplete) lines.push(labels.missingCommanders);
  lines.push('', `${labels.median}: ${summary.medianDurationSeconds === null ? labels.unavailable
    : `${formatDuration(summary.medianDurationSeconds)} (${summary.durationSample}/${summary.totalMatches})`}`);
  return {title: `${name} - 21Life`, text: lines.join('\n'), filename: `21life-recap-${period.firstDay}-${period.lastDay}.txt`};
}
