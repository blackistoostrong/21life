import { NextResponse } from 'next/server';
import { isPlatformAdministrator } from '@/lib/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { enforceUserRateLimit } from '@/lib/api-rate-limit';
import { parseAdminUserFilters, adminUsersCsv } from '@/lib/admin-users-contract';
import { ADMIN_USER_EXPORT_LIMIT, fetchAdminUsers } from '@/lib/admin-users-server';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request) {
  let userId: string;
  try {
    const client = await createServerSupabaseClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user || !(await isPlatformAdministrator(client, user))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: privateHeaders });
    }
    userId = user.id;
  } catch {
    return NextResponse.json({ error: 'Access verification unavailable' }, { status: 503, headers: privateHeaders });
  }
  const params = new URL(request.url).searchParams;
  const format = params.get('format');
  if (params.getAll('format').length > 1 || (format !== null && format !== 'csv')) {
    return NextResponse.json({ error: 'Invalid format' }, { status: 400, headers: privateHeaders });
  }
  params.delete('format');
  let filters;
  try { filters = parseAdminUserFilters(params); }
  catch { return NextResponse.json({ error: 'Invalid filters' }, { status: 400, headers: privateHeaders }); }
  const exporting = format === 'csv';
  try {
    const limited = await enforceUserRateLimit(userId, exporting ? 'adminUsersExport' : 'adminUsers');
    if (limited) {
      for (const [key, value] of Object.entries(privateHeaders)) limited.headers.set(key, value);
      return limited;
    }
    const report = await fetchAdminUsers(filters, exporting);
    if (!exporting) return NextResponse.json(report, { headers: privateHeaders });
    if (report.total > ADMIN_USER_EXPORT_LIMIT || report.users.length !== report.total) {
      return NextResponse.json({ error: 'Export limit exceeded. Narrow the filters.' }, { status: 413, headers: privateHeaders });
    }
    const csv = adminUsersCsv(report, filters);
    if (Buffer.byteLength(csv, 'utf8') > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'Export size exceeded. Narrow the filters.' }, { status: 413, headers: privateHeaders });
    }
    return new Response(csv, { headers: { ...privateHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="21life-users.csv"',
    } });
  } catch {
    console.error('ADMIN_USERS_REPORT_FAILED');
    return NextResponse.json({ error: 'User report unavailable. Please retry.' }, { status: 503, headers: privateHeaders });
  }
}
