import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAnalyticsDashboard } from '@/packages/domain/analytics-dashboard-contract';
import { buildAnalyticsDashboard } from '@/packages/domain/analytics-dashboard';

describe('real SQL dashboard serialization', () => {
  it.skipIf(!process.env.ANALYTICS_SQL_PAYLOAD_PATH)('matches the shared web/native client contract above the API row cap', () => {
    const payload = parseAnalyticsDashboard(JSON.parse(readFileSync(process.env.ANALYTICS_SQL_PAYLOAD_PATH!,'utf8')));
    const result = buildAnalyticsDashboard(payload);
    expect(result.gamesPlayed).toBe(5001);
    expect(result.sample.scope).toBe('personal');
    expect(result.uniqueDecks).toBe(4);
    expect(result.topDecks).toHaveLength(4);
    expect(result.sample.complete).toBe(true);
  });
});
