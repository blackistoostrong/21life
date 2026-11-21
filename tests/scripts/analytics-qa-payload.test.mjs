import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAnalyticsQaPayload,extractHistoryQaPayload,extractArenaBundleQaPayload } from '../../scripts/analytics-qa-payload.mjs';

test('analytics QA cannot report a missing, duplicated or malformed SQL payload as valid', () => {
  for (const output of ['', 'QA26_ANALYTICS_PAYLOAD=bad', 'QA26_ANALYTICS_PAYLOAD={}\nQA26_ANALYTICS_PAYLOAD={}', 'QA26_ANALYTICS_PAYLOAD={"schemaVersion":1}']) {
    assert.throws(()=>extractAnalyticsQaPayload(output));
  }
});
test('analytics QA extracts only the complete synthetic personal response', () => {
  const payload = { schemaVersion: 2, complete: true, scope: 'personal', totals: { gamesPlayed: 5001 } };
  assert.deepEqual(extractAnalyticsQaPayload('plan\nQA26_ANALYTICS_PAYLOAD='+JSON.stringify(payload)+'\nnotice'),payload);
});
test('history QA refuses missing, duplicated, malformed or foreign-group envelopes',()=>{
  for(const output of ['', 'QA26_HISTORY_PAYLOAD=bad','QA26_HISTORY_PAYLOAD={}\nQA26_HISTORY_PAYLOAD={}',
    'QA26_HISTORY_PAYLOAD='+JSON.stringify({page:{schemaVersion:2,complete:true,groupId:'one'},summary:{schemaVersion:2,complete:true,groupId:'other'}})]) {
    assert.throws(()=>extractHistoryQaPayload(output));
  }
});
test('history QA exports the complete synthetic page and matching summaries',()=>{
  const payload={page:{schemaVersion:2,complete:true,groupId:'synthetic'},summary:{schemaVersion:2,complete:true,groupId:'synthetic'}};
  assert.deepEqual(extractHistoryQaPayload('plan\nQA26_HISTORY_PAYLOAD='+JSON.stringify(payload)+'\nnotice'),payload);
});

test('arena bundle QA extracts only one complete versioned response',()=>{
  const payload={schemaVersion:2,complete:true,groupId:'synthetic',players:[]};
  assert.deepEqual(extractArenaBundleQaPayload('plan\nQA26_ARENA_BUNDLE_PAYLOAD='+JSON.stringify(payload)+'\nnotice'),payload);
  for(const output of ['', 'QA26_ARENA_BUNDLE_PAYLOAD=bad','QA26_ARENA_BUNDLE_PAYLOAD={}\nQA26_ARENA_BUNDLE_PAYLOAD={}',
    'QA26_ARENA_BUNDLE_PAYLOAD='+JSON.stringify({...payload,complete:false})])assert.throws(()=>extractArenaBundleQaPayload(output));
});
