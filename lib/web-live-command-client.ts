import {createClient} from '@supabase/supabase-js';
import {supabase} from '@/lib/supabase';
import {withRequestDeadline} from '@/packages/data/request-deadline';

/** One operation keeps its actor/JWT; SDK retries remain inside the same lease. */
export async function createWebLiveCommandClient(actorId:string,signal:AbortSignal){
  const {data,error}=await withRequestDeadline({abortSignal:()=>supabase.auth.getSession()},15000,signal);
  signal.throwIfAborted();
  if(error||data.session?.user.id!==actorId||!data.session.access_token){
    throw Object.assign(new Error('Sign-in required'),{status:401});
  }
  const accessToken=data.session.access_token;
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    accessToken:async()=>{signal.throwIfAborted();return accessToken;},
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async(input,init)=>{
      const request=new Request(input,init);
      const parent=AbortSignal.any([signal,request.signal]);
      return withRequestDeadline({abortSignal:async deadline=>{
        const response=await fetch(new Request(request,{signal:deadline}));
        if([204,205,304].includes(response.status))return response;
        const body=await response.arrayBuffer();
        return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
      }},15000,parent);
    }},
  });
  return {client,accessToken};
}
