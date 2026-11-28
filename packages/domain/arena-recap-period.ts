export type ArenaRecapDays = 7 | 30;
export type ArenaRecapPeriod = Readonly<{
  days: ArenaRecapDays;
  since: string;
  until: string;
  firstDay: string;
  lastDay: string;
  timeZone: string;
}>;

function dayLabel(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Device calendar days, including today; never subtract fixed 24-hour periods. */
export function arenaRecapPeriod(days: ArenaRecapDays, now: Date): ArenaRecapPeriod {
  if ((days !== 7 && days !== 30) || !Number.isFinite(now.getTime())) throw new Error('ARENA_RECAP_PERIOD_INVALID');
  const start = new Date(now), end = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timeZone || start.getFullYear() < 1 || end.getFullYear() > 9999) throw new Error('ARENA_RECAP_PERIOD_INVALID');
  return {days, since: start.toISOString(), until: end.toISOString(), firstDay: dayLabel(start), lastDay: dayLabel(now), timeZone};
}
