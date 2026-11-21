import { NextResponse } from 'next/server';
import { fetchGlobalAnalyticsReportForAdmin } from '@/lib/global-analytics-query';
import { buildAnalyticsDashboard } from '@/packages/domain/analytics-dashboard';
import { isPlatformAdministrator } from '@/lib/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { enforceUserRateLimit } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';

const privateHeaders = { 'Cache-Control': 'no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request) {
  let userId: string;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user || !(await isPlatformAdministrator(supabase, user))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: privateHeaders });
    }
    userId=user.id;
  } catch {
    return NextResponse.json({ error: 'Access verification unavailable' },{ status: 503,headers: privateHeaders });
  }

  try {
    const limited=await enforceUserRateLimit(userId,'adminAnalytics');
    if (limited) {
      for (const [key,value] of Object.entries(privateHeaders)) limited.headers.set(key,value);
      return limited;
    }
    const report = await fetchGlobalAnalyticsReportForAdmin(request.signal);
    const analytics = buildAnalyticsDashboard(report);
    return NextResponse.json({ analytics, report },{ headers: privateHeaders });
  } catch (queryError) {
    console.error('GLOBAL_ANALYTICS_FAILED',queryError instanceof Error ? queryError.name : 'Error');
    return NextResponse.json({ error: 'Failed to load global analytics.' }, { status: 503, headers: privateHeaders });
  }
}
