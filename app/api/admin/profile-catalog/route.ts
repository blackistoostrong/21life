import { NextResponse } from 'next/server';
import { fetchGlobalProfileCatalogPage } from '@/lib/global-profile-query';
import { isPlatformAdministrator } from '@/lib/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { enforceUserRateLimit } from '@/lib/api-rate-limit';

export const runtime='nodejs';
const headers={ 'Cache-Control':'no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff' };
export async function GET(request: Request) {
  const params=new URL(request.url).searchParams;
  const after=params.get('after'),revision=params.get('revision');
  if ((after!==null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after))
    || (revision!==null && !/^[a-f0-9]{32}$/.test(revision)) || (after!==null && revision===null)) return NextResponse.json({error:'Invalid catalog cursor'},{status:400,headers});
  try {
    const client=await createServerSupabaseClient();
    const { data:{user},error }=await client.auth.getUser();
    if (error || !user || !(await isPlatformAdministrator(client,user))) return NextResponse.json({ error:'Forbidden' },{ status:403,headers });
    const limited=await enforceUserRateLimit(user.id,'adminCatalog');
    if (limited) {
      for (const [key,value] of Object.entries(headers)) limited.headers.set(key,value);
      return limited;
    }
    return NextResponse.json(await fetchGlobalProfileCatalogPage(after,revision,request.signal),{ headers });
  } catch { return NextResponse.json({ error:'Profile analytics unavailable' },{ status:503,headers }); }
}
