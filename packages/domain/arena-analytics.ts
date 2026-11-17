import { arenaHistoryScope, compareArenaHistoryTime } from './arena-history';

export type ArenaAnalyticsScope = { groupId: string; since: string | null; until: string | null; bracket: string | null };
export type ArenaPlayerAggregate = {
  key: string; user_id: string | null; guest_id: string | null; display_name: string; is_guest: boolean;
  games_played: number; wins: number; draws: number; second_places: number; eliminations: number;
  total_damage_dealt: number; first_eliminations: number; combo_wins: number; last_standing_wins: number;
  concession_wins: number; alternate_wins: number; max_life_gained: number; starts: number;
};
export type ArenaCommanderAggregate = {
  commander: string; commander_image: string | null; bracket: string | null;
  games_played: number; wins: number; draws: number;
};
export type ArenaColorAggregate = { color_identity: string[]; bracket: string | null; appearances: number; wins: number; draws: number };
export type ArenaDeckAggregate = {
  key: string; deck_id: string; is_guest_deck: boolean; deck_name: string; commander: string;
  commander_image: string | null; owner_display_name: string; bracket: string | null;
  games_played: number; wins: number; draws: number; tracked_games: number; second_places: number;
  first_eliminations: number; comeback_wins: number; combo_wins: number; alternate_wins: number;
  total_damage_dealt: number; total_damage_taken: number; total_life_gained: number;
  commander_damage_dealt: number; infect_dealt: number; eliminations: number;
  group_damage_dealt: number; group_damage_events: number; median_winning_duration_seconds: number | null;
};
export type ArenaAnalyticsReport = {
  schemaVersion: 2; complete: true; asOf: string; groupId: string;
  filters: Omit<ArenaAnalyticsScope, 'groupId'>; totalMatches: number; participations: number;
  rankingParticipations: number; unknownColorParticipations: number;
  unlinkedDeckParticipations: number; unlinkedPlayerParticipations: number; bracketOptions: string[];
  players: ArenaPlayerAggregate[]; commanders: ArenaCommanderAggregate[];
  colors: ArenaColorAggregate[]; decks: ArenaDeckAggregate[];
};

function invalid(): never { throw new Error('ARENA_ANALYTICS_CONTRACT_INVALID'); }
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function text(value: unknown): string { return typeof value === 'string' ? value : invalid(); }
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function uuid(value: unknown): string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : invalid();
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : invalid(); }
function unique(values: string[]): void { if (new Set(values).size !== values.length) invalid(); }
function sameTime(left: string | null, right: string | null): boolean {
  return left === null || right === null ? left === right : compareArenaHistoryTime(left, right) === 0;
}
export function arenaAnalyticsScope(groupId: string, filters: Partial<Omit<ArenaAnalyticsScope, 'groupId'>> = {}): ArenaAnalyticsScope {
  try {
    const period = arenaHistoryScope(groupId, filters);
    const bracket = filters.bracket ?? null;
    if (bracket !== null && (typeof bracket !== 'string' || !bracket || bracket !== bracket.trim() || bracket.length > 32)) invalid();
    return { groupId: period.groupId, since: period.since, until: period.until, bracket };
  } catch { return invalid(); }
}
function record(row: Record<string, unknown>, population: 'games_played' | 'appearances'): number {
  const games = count(row[population]);
  if (!games || count(row.wins) + count(row.draws) > games) invalid();
  return games;
}
function boundedCounters(row: Record<string, unknown>, fields: string[], maximum: number): void {
  for (const field of fields) if (count(row[field]) > maximum) invalid();
}
function sum(rows: Record<string, unknown>[], field: string): number {
  return count(rows.reduce((total, row) => total + count(row[field]), 0));
}

function validate(value: unknown, scope: ArenaAnalyticsScope): ArenaAnalyticsReport {
  const report = object(value);
  if (report.schemaVersion !== 2 || report.complete !== true || uuid(report.groupId) !== scope.groupId) invalid();
  const filters = object(report.filters);
  if (['since', 'until', 'bracket'].some(field => !Object.hasOwn(filters, field))) invalid();
  const echo = arenaAnalyticsScope(text(report.groupId), filters as Partial<ArenaAnalyticsScope>);
  if (!sameTime(echo.since, scope.since) || !sameTime(echo.until, scope.until) || echo.bracket !== scope.bracket) invalid();
  arenaHistoryScope(scope.groupId, { since: text(report.asOf) });
  const total = count(report.totalMatches), participations = count(report.participations);
  const ranking = count(report.rankingParticipations), unknownColors = count(report.unknownColorParticipations);
  const unlinkedDecks = count(report.unlinkedDeckParticipations), unlinkedPlayers = count(report.unlinkedPlayerParticipations);
  if (total > participations || ranking > participations || ranking < total
    || (total === 0) !== (participations === 0) || (scope.bracket === null && ranking !== participations)) invalid();
  const brackets = array(report.bracketOptions).map(value => {
    const bracket = text(value);
    arenaAnalyticsScope(scope.groupId, { bracket });
    return bracket;
  });
  unique(brackets);
  if (scope.bracket !== null && ranking > 0 && !brackets.includes(scope.bracket)) invalid();

  const players = array(report.players).map(value => {
    const row = object(value), games = record(row, 'games_played');
    const userId = row.user_id === null ? null : uuid(row.user_id);
    const guestId = row.guest_id === null ? null : uuid(row.guest_id);
    if ((userId === null) === (guestId === null) || row.is_guest !== (guestId !== null)
      || row.key !== (userId ? `user:${userId}` : `guest:${guestId}`) || games > total) invalid();
    text(row.display_name);
    boundedCounters(row, ['second_places', 'first_eliminations', 'starts'], games);
    boundedCounters(row, ['combo_wins', 'last_standing_wins', 'concession_wins', 'alternate_wins'], count(row.wins));
    if (['combo_wins', 'last_standing_wins', 'concession_wins', 'alternate_wins'].reduce((n, key) => n + count(row[key]), 0) > count(row.wins)) invalid();
    for (const field of ['eliminations', 'total_damage_dealt', 'max_life_gained']) count(row[field]);
    return row;
  });
  unique(players.map(row => text(row.key)));
  const commanders = array(report.commanders).map(value => {
    const row = object(value); record(row, 'games_played'); text(row.commander);
    nullableText(row.commander_image); nullableText(row.bracket);
    if (row.bracket !== null && !brackets.includes(text(row.bracket))) invalid();
    if (scope.bracket !== null && row.bracket !== scope.bracket) invalid();
    return row;
  });
  unique(commanders.map(row => JSON.stringify([row.commander, row.commander_image, row.bracket])));
  const colors = array(report.colors).map(value => {
    const row = object(value); record(row, 'appearances'); nullableText(row.bracket);
    if (row.bracket !== null && !brackets.includes(text(row.bracket))) invalid();
    const identity = array(row.color_identity).map(text);
    if (identity.some(color => !['W', 'U', 'B', 'R', 'G', 'C'].includes(color))) invalid();
    unique(identity);
    if (scope.bracket !== null && row.bracket !== scope.bracket) invalid();
    return row;
  });
  unique(colors.map(row => JSON.stringify([row.color_identity, row.bracket])));
  const decks = array(report.decks).map(value => {
    const row = object(value), games = record(row, 'games_played');
    const id = uuid(row.deck_id);
    if (typeof row.is_guest_deck !== 'boolean' || row.key !== `${row.is_guest_deck ? 'guest' : 'deck'}:${id}`) invalid();
    for (const field of ['deck_name', 'commander', 'owner_display_name']) text(row[field]);
    nullableText(row.commander_image); nullableText(row.bracket);
    if (row.bracket !== null && !brackets.includes(text(row.bracket))) invalid();
    if (scope.bracket !== null && row.bracket !== scope.bracket) invalid();
    boundedCounters(row, ['tracked_games', 'second_places', 'first_eliminations'], games);
    boundedCounters(row, ['comeback_wins', 'combo_wins', 'alternate_wins'], count(row.wins));
    for (const field of ['total_damage_dealt', 'total_damage_taken', 'total_life_gained', 'commander_damage_dealt', 'infect_dealt', 'eliminations', 'group_damage_dealt', 'group_damage_events']) count(row[field]);
    if (row.median_winning_duration_seconds !== null
      && (!count(row.median_winning_duration_seconds) || !count(row.wins) || !count(row.tracked_games))) invalid();
    return row;
  });
  unique(decks.map(row => text(row.key)));
  if (sum(players, 'games_played') + unlinkedPlayers !== participations
    || sum(commanders, 'games_played') !== ranking || sum(colors, 'appearances') + unknownColors !== ranking
    || sum(decks, 'games_played') + unlinkedDecks !== ranking) invalid();
  return { ...report, groupId: scope.groupId } as unknown as ArenaAnalyticsReport;
}
export function parseArenaAnalyticsReport(value: unknown, input: ArenaAnalyticsScope): ArenaAnalyticsReport {
  try { return validate(value, arenaAnalyticsScope(input.groupId, input)); }
  catch { return invalid(); }
}
