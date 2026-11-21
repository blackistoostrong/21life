import type { AdminUserReport } from '@/lib/admin-users-contract';

export function fixtureReport(): AdminUserReport {
  return {
    schemaVersion: 1, asOf: '2026-11-16T00:00:00Z', retentionDays: 30, page: 1, pageSize: 25, total: 1, population: 10,
    summary: { registered: 1, confirmed: 1, unconfirmed: 0, active7d: 1, active30d: 1, new7d: 0 },
    users: [{ id: '00000000-0000-4000-8000-000000000001', username: '=HYPERLINK("bad")', displayName: '  +cmd', email: 'safe@example.com', confirmed: true,
      createdAt: '2026-10-01T00:00:00Z', lastSignInAt: null, lastActiveAt: '2026-11-15T00:00:00Z', source: 'app', appVersion: '9.3.0', games: 8, decks: 2, groups: 1 }],
  };
}
