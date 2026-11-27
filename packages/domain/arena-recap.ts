import {compareArenaHistoryTime} from './arena-history';

export type ArenaRecapParticipant = Readonly<{
  identity: string | null;
  displayName: string | null;
  commander: string | null;
  isWinner: boolean;
}>;
export type ArenaRecapMatch = Readonly<{
  id: string;
  playedAt: string;
  isDraw: boolean | null;
  durationSeconds: number | null;
  trackingVersion: number | null;
  participants: readonly ArenaRecapParticipant[];
}>;
export type ArenaRecapSummary = Readonly<{
  totalMatches: number;
  wins: number;
  draws: number;
  unknownResults: number;
  distinctPlayers: number | null;
  identityDataIncomplete: boolean;
  commanderDataIncomplete: boolean;
  players: readonly Readonly<{alias: number; displayName: string | null; gamesPlayed: number; wins: number; draws: number}>[];
  topCommanders: readonly Readonly<{commander: string; appearances: number}>[];
  medianDurationSeconds: number | null;
  durationSample: number;
}>;

/** User-controlled labels cannot add lines or unbounded content to the share body. */
export function cleanArenaRecapLabel(value: string): string {
  return Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 160).join('');
}
function compare(a: string, b: string): number {return a < b ? -1 : a > b ? 1 : 0;}
function invalid(): never {throw new Error('ARENA_RECAP_CONTRACT_INVALID');}

/** Input must come from a complete revision-checked period, never visible history pages. */
export function summarizeArenaRecap(matches: readonly ArenaRecapMatch[]): ArenaRecapSummary {
  const identities = new Map<string, {displayName: string | null; latest: string | null; latestId: string; gamesPlayed: number; wins: number; draws: number}>();
  const commanders = new Map<string, {commander: string; appearances: number}>();
  const durations: number[] = [], ids = new Set<string>();
  let wins = 0, draws = 0, unknownResults = 0, identityDataIncomplete = false, commanderDataIncomplete = false;
  for (const match of matches) {
    if (ids.has(match.id) || !Number.isFinite(Date.parse(match.playedAt))) invalid();
    ids.add(match.id);
    if (match.trackingVersion !== null && (!Number.isSafeInteger(match.trackingVersion) || match.trackingVersion < 0)) invalid();
    const winners = match.participants.filter(participant => participant.isWinner).length;
    if (winners > 1 || (match.isDraw === true && winners > 0)) invalid();
    if (match.isDraw === true) draws++;
    else if (winners === 1) wins++;
    else unknownResults++;
    if (match.durationSeconds !== null) {
      if (!Number.isSafeInteger(match.durationSeconds) || match.durationSeconds < 0) invalid();
      // Legacy/manual zero is not evidence of a measured duration.
      if (match.durationSeconds > 0 || (match.trackingVersion !== null && match.trackingVersion > 0)) durations.push(match.durationSeconds);
    }
    if (match.participants.length === 0) {identityDataIncomplete = true; commanderDataIncomplete = true;}
    const seats = new Set<string>();
    for (const participant of match.participants) {
      if (participant.identity === null) identityDataIncomplete = true;
      else {
        if (seats.has(participant.identity)) invalid();
        seats.add(participant.identity);
        const name = participant.displayName ? cleanArenaRecapLabel(participant.displayName) || null : null;
        const row = identities.get(participant.identity) ?? {displayName: null, latest: null, latestId: '', gamesPlayed: 0, wins: 0, draws: 0};
        const order = row.latest === null ? 1 : compareArenaHistoryTime(match.playedAt, row.latest);
        if (name && (order > 0 || (order === 0 && compare(match.id, row.latestId) > 0))) {
          row.displayName = name; row.latest = match.playedAt; row.latestId = match.id;
        }
        row.gamesPlayed++; if (participant.isWinner) row.wins++; if (match.isDraw === true) row.draws++;
        identities.set(participant.identity, row);
      }
      const commander = participant.commander ? cleanArenaRecapLabel(participant.commander) : '';
      if (!commander) commanderDataIncomplete = true;
      else {
        const key = commander.toLowerCase(), row = commanders.get(key) ?? {commander, appearances: 0};
        row.appearances++; if (compare(commander, row.commander) < 0) row.commander = commander;
        commanders.set(key, row);
      }
    }
  }
  durations.sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return {
    totalMatches: matches.length, wins, draws, unknownResults, identityDataIncomplete, commanderDataIncomplete,
    distinctPlayers: identityDataIncomplete ? null : identities.size,
    players: Array.from(identities).sort(([a], [b]) => compare(a, b)).map(([, row], index) => ({
      alias: index + 1, displayName: row.displayName, gamesPlayed: row.gamesPlayed, wins: row.wins, draws: row.draws,
    })),
    topCommanders: Array.from(commanders.values()).sort((a, b) => b.appearances - a.appearances
      || compare(a.commander.toLowerCase(), b.commander.toLowerCase())).slice(0, 3),
    medianDurationSeconds: durations.length === 0 ? null : durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2,
    durationSample: durations.length,
  };
}
