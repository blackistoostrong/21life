import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAnalyticsQaPayload } from '../../scripts/analytics-qa-payload.mjs';

test('analytics QA cannot report a missing, duplicated or malformed SQL payload as valid', () => {
  for (const output of ['', 'QA26_ANALYTICS_PAYLOAD=bad', 'QA26_ANALYTICS_PAYLOAD={}\nQA26_ANALYTICS_PAYLOAD={}', 'QA26_ANALYTICS_PAYLOAD={"schemaVersion":1}']) {
    assert.throws(()=>extractAnalyticsQaPayload(output));
  }
});
test('analytics QA extracts only the complete synthetic personal response', () => {
  const payload = { schemaVersion: 2, complete: true, scope: 'personal', totals: { gamesPlayed: 5001 } };
  assert.deepEqual(extractAnalyticsQaPayload('plan\nQA26_ANALYTICS_PAYLOAD='+JSON.stringify(payload)+'\nnotice'),payload);
});
