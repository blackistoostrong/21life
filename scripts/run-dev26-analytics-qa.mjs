import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import nextEnv from '@next/env';
import { extractAnalyticsQaPayload, extractHistoryQaPayload, extractArenaBundleQaPayload } from './analytics-qa-payload.mjs';

if (process.argv.slice(2).some(arg => !['--draft','--profile-draft','--profile','--history-draft','--history','--admin-scope-draft','--admin-scope','--arena-bundle-draft','--arena-bundle'].includes(arg))) throw new Error('Unsupported QA option');
nextEnv.loadEnvConfig(resolve(process.env.E2E_ENV_ROOT || '.'));
const env = process.env;
if (env.SELFHOSTED_DEV_COMPOSE_PROJECT !== 'supabase-dev' || !env.SUPABASE_URL
  || new URL(env.SUPABASE_URL).hostname !== env.STAGING_SUPABASE_DOMAIN) throw new Error('Explicit Dev backend required');
if (!/^[a-z_][a-z0-9_-]*$/i.test(env.SELFHOSTED_DEV_VM_USER || '') || !/^[a-z0-9_.:-]+$/i.test(env.SELFHOSTED_DEV_VM_HOST || '')) throw new Error('Invalid Dev SSH target');
const args = ['-o','BatchMode=yes','-o','ConnectTimeout=15'];
if (env.SELFHOSTED_DEV_VM_KEY_PATH) args.push('-i',env.SELFHOSTED_DEV_VM_KEY_PATH);
if (env.SELFHOSTED_DEV_VM_PORT) {
  const port = Number(env.SELFHOSTED_DEV_VM_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Dev SSH port');
  args.push('-p',String(port));
}
args.push(`${env.SELFHOSTED_DEV_VM_USER}@${env.SELFHOSTED_DEV_VM_HOST}`,
  'docker exec -i supabase-dev-db psql -X -qAt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres');
let sql = readFileSync(resolve('scripts/qa/analytics-dashboard-v2.sql'),'utf8');
if (!sql.includes('BEGIN ISOLATION LEVEL REPEATABLE READ;') || !/ROLLBACK;\s*$/.test(sql)) throw new Error('QA must end with rollback');
if (process.argv.includes('--draft')) {
  sql = 'BEGIN ISOLATION LEVEL REPEATABLE READ;\n'
    + readFileSync(resolve('supabase/migrations/20261116135644_analytics_dashboard_v2.sql'),'utf8') + '\n'
    + sql.replace(/^BEGIN ISOLATION LEVEL REPEATABLE READ;\r?\n/m,'');
}
if (process.argv.includes('--profile-draft')) {
  sql = sql.replace('BEGIN ISOLATION LEVEL REPEATABLE READ;', () => 'BEGIN ISOLATION LEVEL REPEATABLE READ;\n'
    + readFileSync(resolve('supabase/migrations/20261116150922_profile_catalog_metrics_v2.sql'),'utf8'));
}
if (process.argv.includes('--history-draft')) {
  sql = sql.replace('BEGIN ISOLATION LEVEL REPEATABLE READ;', () => 'BEGIN ISOLATION LEVEL REPEATABLE READ;\n'
    + readFileSync(resolve('supabase/migrations/20261117075535_arena_history_pages_v2.sql'),'utf8'));
}
if (process.argv.includes('--arena-bundle-draft')) {
  sql = sql.replace('BEGIN ISOLATION LEVEL REPEATABLE READ;', () => 'BEGIN ISOLATION LEVEL REPEATABLE READ;\n'
    + readFileSync(resolve('supabase/migrations/20261117134213_arena_analytics_bundle_v2.sql'),'utf8'));
}
if (process.argv.includes('--admin-scope-draft')) {
  sql = sql.replace('BEGIN ISOLATION LEVEL REPEATABLE READ;', () => 'BEGIN ISOLATION LEVEL REPEATABLE READ;\n'
    + readFileSync(resolve('supabase/migrations/20261117082649_scope_admin_row_security_setting.sql'),'utf8'));
}
if (['--profile-draft','--profile','--history-draft','--history'].some(flag=>process.argv.includes(flag))) {
  sql = sql.replace(/ROLLBACK;\s*$/,() => readFileSync(resolve('scripts/qa/profile-catalog-metrics-v2.sql'),'utf8') + '\nROLLBACK;\n');
}
if (process.argv.includes('--history-draft') || process.argv.includes('--history')) {
  sql = sql.replace(/ROLLBACK;\s*$/,() => readFileSync(resolve('scripts/qa/arena-history-v2.sql'),'utf8') + '\nROLLBACK;\n');
}
if (process.argv.includes('--admin-scope-draft') || process.argv.includes('--admin-scope')) {
  sql = sql.replace(/ROLLBACK;\s*$/,() => readFileSync(resolve('scripts/qa/admin-row-security-scope.sql'),'utf8') + '\nROLLBACK;\n');
}
if (process.argv.includes('--arena-bundle-draft') || process.argv.includes('--arena-bundle')) {
  sql = sql.replace(/ROLLBACK;\s*$/,() => readFileSync(resolve('scripts/qa/arena-analytics-bundle-v2.sql'),'utf8') + '\nROLLBACK;\n');
}
const result = spawnSync('ssh',args,{ input: sql, encoding: 'utf8', timeout: 120000, windowsHide: true });
const directory = resolve('artifacts/dev26');
mkdirSync(directory,{ recursive: true });
// Synthetic payload is retained separately, not mixed into terminal output.
writeFileSync(resolve(directory,'analytics-reusable-qa.log'),(result.stdout || '').replace(/^QA26_(?:ANALYTICS|HISTORY|ARENA_BUNDLE)_PAYLOAD=.*\r?\n?/gm,'') + (result.stderr || ''));
if (result.error || result.status !== 0) throw new Error('Dev analytics QA failed; inspect artifacts/dev26/analytics-reusable-qa.log');
writeFileSync(resolve(directory,'analytics-sql-payload.json'),JSON.stringify(extractAnalyticsQaPayload(result.stdout)));
if (process.argv.includes('--history-draft') || process.argv.includes('--history')) {
  writeFileSync(resolve(directory,'history-sql-payload.json'),JSON.stringify(extractHistoryQaPayload(result.stdout)));
}
if(process.argv.includes('--arena-bundle-draft') || process.argv.includes('--arena-bundle')) {
  writeFileSync(resolve(directory,'arena-bundle-sql-payload.json'),JSON.stringify(extractArenaBundleQaPayload(result.stdout)));
}
console.log('Dev analytics SQL roles/counts/performance PASS; transaction rolled back; synthetic payload saved for contract validation.');
