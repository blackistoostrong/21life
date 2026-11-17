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
export function extractHistoryQaPayload(output) {
  const lines=output.split(/\r?\n/).filter(line=>line.startsWith('QA26_HISTORY_PAYLOAD='));
  if(lines.length!==1)throw new Error('Expected exactly one synthetic history payload');
  const value=JSON.parse(lines[0].slice('QA26_HISTORY_PAYLOAD='.length));
  if(value?.page?.schemaVersion!==2 || value?.page?.complete!==true || value?.summary?.schemaVersion!==2
    || value?.summary?.complete!==true || !value?.page?.groupId || value.page.groupId!==value.summary.groupId)throw new Error('Invalid synthetic history envelope');
  return value;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input,output,kind='analytics'] = process.argv.slice(2);
  if (!input || !output || !['analytics','history'].includes(kind)) throw new Error('Usage: node scripts/analytics-qa-payload.mjs <qa-log> <payload-file> [analytics|history]');
  const extract=kind==='history'?extractHistoryQaPayload:extractAnalyticsQaPayload;
  writeFileSync(output,JSON.stringify(extract(readFileSync(input,'utf8'))));
}
