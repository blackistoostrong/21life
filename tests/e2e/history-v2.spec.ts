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
  await page.route('**/rest/v1/rpc/get_arena_analytics_bundle_v2',route=>route.fulfill({status:503,json:{message:'Synthetic aggregate outage'}}));
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


test('history UI pages exact totals, retries failures and restarts changed revisions',async({page})=>{
  test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
  const groupId=process.env.E2E_GROUP_ID!;
  let failure:'unavailable'|'changed'|null='unavailable';
  const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  let sharedText='';
  await page.exposeFunction('captureHistoryExport',(value:{text:string})=>{sharedText=value.text;});
  await page.addInitScript(()=>Object.defineProperty(navigator,'share',{configurable:true,value:(value:unknown)=>(window as unknown as {captureHistoryExport:(value:unknown)=>Promise<void>}).captureHistoryExport(value)}));
  const rows=Array.from({length:201},(_,index)=>({id:id(201-index),group_id:groupId,created_by:process.env.E2E_USER_ID,
    played_at:index===200?null:'2026-11-15T21:00:00Z',arena_day_key:index===200?'undated':'2026-11-15',
    winner_id:null,winner_guest_id:null,is_draw:true,notes:`Export match ${201-index}`,match_participants:[]}));
  await page.route('**/rest/v1/rpc/get_arena_season_context',route=>route.fulfill({status:200,json:{enabled:false}}));
  await page.route('**/rest/v1/rpc/get_arena_history_page_v2',route=>{
    const args=route.request().postDataJSON();
    if(args.p_before_id && failure)return route.fulfill({status:failure==='changed'?409:503,json:{code:failure==='changed'?'40001':'XX000'}});
    const filtered=args.p_day_key?rows.filter(row=>row.arena_day_key===args.p_day_key):rows;
    const start=args.p_before_id?filtered.findIndex(row=>row.id===args.p_before_id)+1:0;
    const matches=filtered.slice(start,start+args.p_limit);const last=matches.at(-1)!;
    return route.fulfill({status:200,json:{schemaVersion:2,complete:true,asOf:'2026-11-17T12:00:00Z',groupId,revision:'a'.repeat(32),total:filtered.length,
      filters:{since:args.p_since,until:args.p_until,dayKey:args.p_day_key,boundaryHour:args.p_boundary_hour},matches,
      next:start+matches.length<filtered.length?{id:last.id,playedAt:last.played_at}:null}});
  });
  await fixtureLogin(page);await page.goto(`/table/${groupId}`);
  await expect(page.getByRole('status').filter({hasText:'Matches 1–100 of 201'})).toBeVisible();
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'History unavailable.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'No matches yet',exact:true})).toHaveCount(0);
  failure=null;await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Matches 101–200 of 201'})).toBeVisible();
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Matches 201–201 of 201'})).toBeVisible();
  await expect(page.getByText('Date unavailable',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Previous',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Matches 101–200 of 201'})).toBeVisible();
  failure='changed';await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'History changed.'})).toBeVisible();
  failure=null;await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Matches 1–100 of 201'})).toBeVisible();
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await expect(page.getByText('200 matches in period · complete export',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Generate export',exact:true}).click();
  await expect.poll(()=>sharedText.length).toBeGreaterThan(0);
  expect(sharedText.match(/Export match /g)?.length).toBe(200);
});


test('arena settings editor preserves drafts, dropdown, save errors and command scope', async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const groupId = process.env.E2E_GROUP_ID!;
  const updates: Array<Record<string, unknown>> = [];
  const seasonUpdates: Array<Record<string, unknown>> = [];
  let failMetadata = true;
  await page.route('**/rest/v1/groups?*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${groupId}`);
    updates.push(route.request().postDataJSON());
    return route.fulfill({ status: failMetadata ? 403 : 204,
      ...(failMetadata ? { json: { message: 'Synthetic settings rejection', code: '42501' } } : {}) });
  });
  await page.route('**/rest/v1/rpc/set_arena_season_settings', (route) => {
    seasonUpdates.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, json: { enabled: false } });
  });
  await fixtureLogin(page);
  await page.goto(`/table/${groupId}`);
  const open = page.getByRole('button', { name: 'Edit playgroup', exact: true });
  const name = page.getByPlaceholder('My Playgroup', { exact: true });
  await open.click();
  const originalName = await name.inputValue();
  await name.fill('Discarded settings draft');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await open.click();
  await expect(name).toHaveValue(originalName);
  await name.fill('   ');
  const save = page.getByRole('button', { name: 'Save Changes', exact: true });
  await expect(save).toBeDisabled();
  await name.fill('  Edited playgroup  ');
  await page.getByPlaceholder('A description of this playgroup...', { exact: true }).fill('  New description  ');
  await page.getByLabel('Enable seasons', { exact: true }).check();
  await page.getByLabel('Season start month', { exact: true }).click();
  await page.getByRole('option', { name: 'September', exact: true }).click();
  await save.click();
  await expect(page.getByRole('heading', { name: 'Edit Playgroup', exact: true })).toBeVisible();
  await expect(save).toBeEnabled();
  expect(updates).toHaveLength(1);
  expect(seasonUpdates).toHaveLength(0);
  await expect(name).toHaveValue('  Edited playgroup  ');
  failMetadata = false;
  await save.click();
  await expect(page.getByRole('heading', { name: 'Edit Playgroup', exact: true })).toHaveCount(0);
  expect(updates).toHaveLength(2);
  expect(updates[1]).toMatchObject({ name: 'Edited playgroup', description: 'New description' });
  expect(seasonUpdates).toEqual([{ p_group_id: groupId, p_enabled: true, p_reset_month: 9 }]);
  await open.click();
  await expect(name).toHaveValue('Edited playgroup');
  await expect(page.getByLabel('Season start month', { exact: true })).toContainText('September');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


for (const departure of ['cancel', 'navigate'] as const) {
test(`arena settings editor ${departure} aborts its pending command before reopening`, async ({ page }) => {
  test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
  const groupId = process.env.E2E_GROUP_ID!;
  await page.addInitScript(() => {
    const monitor = { started: 0, aborted: 0 };
    Object.assign(window, { arenaSettingsMonitor: monitor });
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/rest/v1/groups?') && init?.method === 'PATCH') {
        monitor.started++;
        init.signal?.addEventListener('abort', () => { monitor.aborted++; }, { once: true });
      }
      return originalFetch(input, init);
    };
  });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let completed: () => void = () => {};
  const routeCompleted = new Promise<void>((resolve) => { completed = resolve; });
  let seasonWrites = 0;
  await page.route('**/rest/v1/groups?*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await held;
    try { await route.fulfill({ status: 204 }); } finally { completed(); }
  });
  await page.route('**/rest/v1/rpc/set_arena_season_settings', (route) => {
    seasonWrites++;
    return route.fulfill({ status: 200, json: { enabled: false } });
  });
  const monitor = () => page.evaluate(() =>
    (window as unknown as { arenaSettingsMonitor: { started: number; aborted: number } }).arenaSettingsMonitor);
  try {
    await fixtureLogin(page);
    await page.goto(`/table/${groupId}`);
    const open = page.getByRole('button', { name: 'Edit playgroup', exact: true });
    await open.click();
    const name = page.getByPlaceholder('My Playgroup', { exact: true });
    const originalName = await name.inputValue();
    await name.fill('Abandoned pending command');
    await page.getByLabel('Enable seasons', { exact: true }).check();
    await page.getByLabel('Season start month', { exact: true }).click();
    await page.getByRole('option', { name: 'September', exact: true }).click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(async () => (await monitor()).started).toBe(1);
    if (departure === 'cancel') {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    } else {
      // Invoke the existing Next Link while the modal covers the navigation chrome.
      await page.locator('a[href="/profile"]').first().evaluate((link) => (link as HTMLAnchorElement).click());
      await expect(page).toHaveURL(/\/profile$/);
    }
    await expect.poll(async () => (await monitor()).aborted).toBe(1);
    if (departure === 'navigate') {
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/table/${groupId}$`));
    }
    await open.click();
    release();
    await expect(name).toHaveValue(originalName);
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeEnabled();
    expect(seasonWrites).toBe(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    release();
    await routeCompleted;
  }
});
}
