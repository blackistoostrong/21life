import { describe, expect, it } from 'vitest';
import { fixtureReport } from '../fixtures/admin-users';
import { adminUserQuery, adminUsersCsv, DEFAULT_ADMIN_USER_FILTERS, parseAdminUserFilters } from '@/lib/admin-users-contract';


describe('admin users filter and export contract', () => {
  it('roundtrips applied filters without dropping date/source/sort/page', () => {
    expect(parseAdminUserFilters(adminUserQuery(DEFAULT_ADMIN_USER_FILTERS))).toEqual(DEFAULT_ADMIN_USER_FILTERS);
    const filters = { ...DEFAULT_ADMIN_USER_FILTERS, search: 'B%_👋', from: '2024-02-29', to: '2026-11-16', source: 'app' as const, sort: 'games' as const, page: 3 };
    expect(parseAdminUserFilters(adminUserQuery(filters))).toEqual(filters);
  });
  it.each(['from=2026-02-30', 'from=0000-01-01', 'from=2026-11-16&to=2026-11-15', 'page=0', 'page=NaN', 'pageSize=5001', 'sort=sql', 'status=banned', 'source=all&source=app', 'unexpected=true', `search=${'a'.repeat(101)}`])('rejects invalid input %s', query => {
    expect(() => parseAdminUserFilters(new URLSearchParams(query))).toThrow();
  });
  it('protects spreadsheet formulas and quotes, keeps Unicode and full report metadata', () => {
    const report = fixtureReport();
    report.users[0].email = 'multi,"😀\nline';
    const csv = adminUsersCsv(report);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"\'  +cmd"');
    expect(csv).toContain('"multi,""😀\nline"');
    expect(csv).toContain('"Matching users","1"');
    expect(csv).not.toContain(report.users[0].id);
  });
});
