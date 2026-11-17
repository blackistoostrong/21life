import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fetchArenaHistoryDaySummaries,fetchArenaHistoryPage} from '../../packages/data/arena-history-query';
import {arenaHistoryScope} from '../../packages/domain/arena-history';

test('history v2 authenticated API binds complete pages to the permitted group',async()=>{
  test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
  const url=process.env.SUPABASE_URL!;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const client=(token:string)=>({rpc:(name:string,args:Record<string,unknown>)=>({abortSignal:async(signal:AbortSignal)=>{
    const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',signal,headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args)});
    const body:unknown=await response.json();return response.ok?{data:body,error:null}:{data:null,error:body};
  }})});
  const own=client(process.env.E2E_ACCESS_TOKEN!);
  const scope=arenaHistoryScope(process.env.E2E_GROUP_ID!);
  const page=await fetchArenaHistoryPage(own,scope);
  const days=await fetchArenaHistoryDaySummaries(own,scope.groupId);
  expect(page.complete).toBe(true);expect(page.matches.length).toBeLessThanOrEqual(100);
  expect(days.days.reduce((sum,day)=>sum+day.matchCount,0)).toBe(page.total);
  await expect(fetchArenaHistoryPage(own,arenaHistoryScope(randomUUID()))).rejects.toThrow('ARENA_HISTORY_FORBIDDEN');
  await expect(fetchArenaHistoryPage(client(anon),scope)).rejects.toThrow('ARENA_HISTORY_FORBIDDEN');
});
