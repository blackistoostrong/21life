import { createServerClient } from '@supabase/ssr';
import { spawnSync } from 'node:child_process';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!process.env.CI || !url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('Disposable local CI backend required');
}
const cookies = [];
const client = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  cookies: { getAll: () => cookies, setAll: values => cookies.push(...values) },
});
const { data, error } = await client.auth.signInWithPassword({
  email: process.env.E2E_USERNAME, password: process.env.E2E_PASSWORD,
});
if (error || !data.user) throw new Error('CI analytics fixture session unavailable');
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test',
  'tests/e2e/analytics-v2.spec.ts', '--workers=1'], {
  stdio: 'inherit', env: { ...process.env, E2E_ANALYTICS_FLOW: '1', E2E_USER_ID: data.user.id,
    E2E_SESSION_COOKIES: JSON.stringify(cookies.map(({ name, value }) => ({ name, value }))) },
});
process.exitCode = result.status ?? 1;
