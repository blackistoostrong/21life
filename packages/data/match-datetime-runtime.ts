export * from '../domain/match-datetime';
import { toMatchDateValue as formatDate, isoToMatchDateValue as formatIso } from '../domain/match-datetime';

export function toMatchDateValue(date: Date = new Date()): string { return formatDate(date); }
export function isoToMatchDateValue(iso: string | null): string { return formatIso(iso, () => new Date()); }
