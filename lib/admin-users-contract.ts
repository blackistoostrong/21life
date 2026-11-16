import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return value >= '0001-01-01' && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid date');
const count = z.number().int().nonnegative();
const timestamp = z.string().refine(value => value.includes('T') && Number.isFinite(Date.parse(value)), 'Invalid timestamp');

export const adminUserFiltersSchema = z.object({
  search: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'confirmed', 'unconfirmed']).default('all'),
  activity: z.enum(['all', '7d', '30d', 'inactive', 'no_logs']).default('all'),
  source: z.enum(['all', 'web', 'app']).default('all'),
  from: z.union([date, z.literal('')]).default(''),
  to: z.union([date, z.literal('')]).default(''),
  sort: z.enum(['newest', 'oldest', 'active', 'games']).default('newest'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50), z.literal(100)])).default(25),
}).refine(value => !value.from || !value.to || value.from <= value.to, 'Invalid date range');

export type AdminUserFilters = z.infer<typeof adminUserFiltersSchema>;
export const DEFAULT_ADMIN_USER_FILTERS: AdminUserFilters = adminUserFiltersSchema.parse({});
export function parseAdminUserFilters(params: URLSearchParams): AdminUserFilters {
  const keys = Object.keys(DEFAULT_ADMIN_USER_FILTERS);
  if (Array.from(params.keys()).some(key => !keys.includes(key))) throw new Error('Invalid filters');
  if (keys.some(key => params.getAll(key).length > 1)) throw new Error('Duplicate filters');
  return adminUserFiltersSchema.parse(Object.fromEntries(params));
}
export function adminUserQuery(filters: AdminUserFilters) {
  return new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]));
}

export const adminUserRowSchema = z.object({
  id: z.string().uuid(), username: z.string().nullable(), displayName: z.string().nullable(),
  email: z.string().nullable(), confirmed: z.boolean(), createdAt: timestamp.nullable(),
  lastSignInAt: timestamp.nullable(), lastActiveAt: timestamp.nullable(),
  source: z.enum(['web', 'app']).nullable(), appVersion: z.string().nullable(),
  games: count, decks: count, groups: count,
});
export const adminUserReportSchema = z.object({
  schemaVersion: z.literal(1), asOf: timestamp, retentionDays: z.literal(30),
  page: count.min(1), pageSize: count.min(1), total: count, population: count,
  summary: z.object({ registered: count, confirmed: count, unconfirmed: count, active7d: count, active30d: count, new7d: count }),
  users: z.array(adminUserRowSchema),
});
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;
export type AdminUserReport = z.infer<typeof adminUserReportSchema>;

function csvCell(value: string | number | null) {
  let text = value == null ? '' : String(value);
  if (['=', '+', '-', '@'].some(prefix => text.trimStart().startsWith(prefix)) || text.startsWith('\t') || text.startsWith('\r')) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function adminUsersCsv(report: AdminUserReport, filters?: AdminUserFilters) {
  const rows: Array<Array<string | number | null>> = [
    ['Report generated (UTC)', report.asOf], ['Matching users', report.total], ['Activity log retention (days)', report.retentionDays],
    ...(filters ? Object.entries(filters).filter(([key]) => !['page', 'pageSize'].includes(key)).map(([key, value]) => [`Filter: ${key}`, value]) : []),
    ['Username', 'Display name', 'Email', 'Email confirmed', 'Registered (UTC)', 'Last sign-in (UTC)', 'Last logged activity (UTC)', 'Latest source', 'Latest app version', 'Games', 'Decks', 'Groups'],
    ...report.users.map(user => [user.username, user.displayName, user.email, user.confirmed ? 'yes' : 'no', user.createdAt,
      user.lastSignInAt, user.lastActiveAt, user.source, user.appVersion, user.games, user.decks, user.groups]),
  ];
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
