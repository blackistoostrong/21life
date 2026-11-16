import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function extractAnalyticsQaPayload(output) {
  const lines = output.split(/\r?\n/).filter(line => line.startsWith('QA26_ANALYTICS_PAYLOAD='));
  if (lines.length !== 1) throw new Error('Expected exactly one synthetic analytics payload');
  const value = JSON.parse(lines[0].slice('QA26_ANALYTICS_PAYLOAD='.length));
  if (value?.schemaVersion !== 2 || value?.complete !== true || value?.scope !== 'personal') throw new Error('Invalid synthetic analytics envelope');
  return value;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input,output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node scripts/analytics-qa-payload.mjs <qa-log> <payload-file>');
  writeFileSync(output,JSON.stringify(extractAnalyticsQaPayload(readFileSync(input,'utf8'))));
}
