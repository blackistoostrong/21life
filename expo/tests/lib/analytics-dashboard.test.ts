import { describe, expect, it } from 'vitest';
import { buildAnalyticsDashboard } from '../../../packages/domain/analytics-dashboard';
import { parseAnalyticsDashboard } from '../../../packages/domain/analytics-dashboard-contract';
import { analyticsDashboardFixture } from '../../../tests/fixtures/analytics-dashboard';

describe('native complete analytics contract', () => {
  it('uses the same complete counts, draw denominator and samples as web', () => {
    const value=buildAnalyticsDashboard(parseAnalyticsDashboard(analyticsDashboardFixture()));
    expect(value).toMatchObject({ gamesPlayed: 3, decisiveGames: 2, wins: 1, draws: 1, winRate: 50 });
    expect(value.sample).toMatchObject({ schemaVersion: 2, complete: true });
  });
  it('refuses successful but incomplete old-backend responses', () => {
    expect(()=>parseAnalyticsDashboard([])).toThrow('ANALYTICS_CONTRACT_INVALID');
    expect(()=>parseAnalyticsDashboard({ ...analyticsDashboardFixture(), complete: false })).toThrow('ANALYTICS_CONTRACT_INVALID');
  });
});
