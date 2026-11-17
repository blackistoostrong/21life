import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fetchArenaHistoryDaySummaries,fetchArenaHistoryPage} from '../../packages/data/arena-history-query';
import {fixtureLogin} from './fixture-login';
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


test('guest directory UI searches decks and keeps actions usable on narrow screens',async({page})=>{
  test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
  const groupId=process.env.E2E_GROUP_ID!;
  const guestId=randomUUID();
  const guests=[{id:guestId,group_id:groupId,display_name:'José Long Guest Name',last_played_at:null,
    arena_guest_decks:[{id:randomUUID(),guest_id:guestId,group_id:groupId,name:'Blue control',commander:'Talrand, Sky Summoner',commander_image:null,color_identity:['U'],bracket:null},
      {id:randomUUID(),guest_id:guestId,group_id:groupId,name:'Green ramp',commander:'Selvala, Heart of the Wilds',commander_image:null,color_identity:['G'],bracket:null}]},
    {id:randomUUID(),group_id:groupId,display_name:'Guest without decks',last_played_at:null,arena_guest_decks:[]}];
  await page.route('**/rest/v1/arena_guests?*',route=>route.fulfill({status:200,json:guests}));
  await page.route('**/rest/v1/rpc/get_arena_analytics_bundle',route=>route.fulfill({status:503,json:{message:'Synthetic aggregate outage'}}));
  await fixtureLogin(page);
  await page.goto(`/table/${groupId}`);
  await page.getByRole('tab',{name:/Players/}).click();
  await expect(page.getByRole('heading',{name:'Playgroup guests and decks'})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText:'Statistics unavailable.'})).toBeVisible();
  const search=page.getByLabel('Search guest, deck or commander',{exact:true});
  await search.fill('selvala');
  await expect(page.getByText('Green ramp',{exact:true})).toBeVisible();
  await expect(page.getByText('Blue control',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'José Long Guest Name'})).toBeVisible();
  await search.fill('missing commander');
  await expect(page.getByText('No results. Try another name.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await expect(search).toHaveValue('');
  await page.getByRole('button',{name:'Show decks: José Long Guest Name',exact:true}).click();
  await expect(page.getByText('Blue control',{exact:true})).toBeVisible();
  const row=page.getByRole('region',{name:'José Long Guest Name'});
  await row.getByRole('button',{name:'Add deck: José Long Guest Name',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Add guest deck',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Add guest',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Add guest',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`artifacts/dev26/guest-directory-${test.info().project.name}.png`,fullPage:true});
});
