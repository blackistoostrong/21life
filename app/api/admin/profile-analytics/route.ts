import { NextResponse } from 'next/server';
import { fetchGlobalProfileMetrics } from '@/lib/global-profile-query';
import { isPlatformAdministrator } from '@/lib/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { enforceUserRateLimit } from '@/lib/api-rate-limit';

export const runtime='nodejs';
const headers={ 'Cache-Control':'no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff' };
export async function GET(request: Request) {
  try {
    const client=await createServerSupabaseClient();
    const { data:{user},error }=await client.auth.getUser();
    if (error || !user || !(await isPlatformAdministrator(client,user))) return NextResponse.json({ error:'Forbidden' },{ status:403,headers });
    const limited=await enforceUserRateLimit(user.id,'adminAnalytics');
    if (limited) {
      for (const [key,value] of Object.entries(headers)) limited.headers.set(key,value);
      return limited;
    }
    return NextResponse.json(await fetchGlobalProfileMetrics(request.signal),{ headers });
  } catch { return NextResponse.json({ error:'Profile analytics unavailable' },{ status:503,headers }); }
}
