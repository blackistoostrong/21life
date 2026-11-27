import {createClient} from '@supabase/supabase-js';
import {test,expect,type Request} from '@playwright/test';
import {configureTracker} from './live-tracker-fixture';
import {transitionFixtureSession} from './profile-auth-fixture';

for(const transition of ['back','account'] as const){
test(`web live commands cancel pending start validation on ${transition}`,async({page})=>{
  test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
  const groupId=await configureTracker(page);
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  const requests=new Set<Request>();let aborted=0;
  page.on('requestfailed',request=>{if(requests.has(request))aborted++;});
  await page.route('**/rest/v1/live_game_participants?*',async route=>{
    const query=new URL(route.request().url()).searchParams;
    if(query.get('group_id')!==`eq.${groupId}`||query.get('select')!=='participant_key')return route.fallback();
    requests.add(route.request());await pending;
    await route.fulfill({status:403,json:{message:'Synthetic abandoned validation'}}).catch(()=>{});
  });
  try{
    await page.getByTestId('live-start').click();
    await expect.poll(()=>requests.size).toBe(1);
    if(transition==='back'){
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/table/${groupId}$`));
    }else{
      await transitionFixtureSession(page,true);
      await expect(page.getByRole('heading',{name:/Set up the game|Configura la partita/})).toBeVisible();
    }
    await expect.poll(()=>aborted).toBe(1);
    const journal=await page.evaluate(({group,user})=>localStorage.getItem(`phyrexian-arena:web-live-game:v2:${user}:${group}`),{group:groupId,user:process.env.E2E_USER_ID!});
    expect(journal).toBeNull();
  }finally{release();}
});
}

test('web live commands preserve a durable offline start without requesting Auth refresh',async({page})=>{
  test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
  const groupId=await configureTracker(page);
  let authReads=0;
  page.on('request',request=>{if(new URL(request.url()).pathname.includes('/auth/v1/token'))authReads++;});
  await page.evaluate(()=>localStorage.setItem('live-onboarding-v1','done'));
  await page.context().setOffline(true);
  try{
    await page.getByTestId('live-start').click();
    await expect(page.getByTestId('live-end')).toBeVisible();
    const journal=await page.evaluate(({group,user})=>{
      const value=localStorage.getItem(`phyrexian-arena:web-live-game:v2:${user}:${group}`);
      return value?JSON.parse(value).journal:null;
    },{group:groupId,user:process.env.E2E_USER_ID!});
    expect(journal?.needsCreate).toBe(true);
    expect(journal?.record.state.players).toHaveLength(2);
    expect(authReads).toBe(0);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/table/${groupId}$`));
  }finally{await page.context().setOffline(false);}
});


test('web live commands rematch validates real Dev references and creates a fresh synced round',async({page})=>{
 test.setTimeout(90000);test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
 const backend=process.env.NEXT_PUBLIC_SUPABASE_URL!;
 if(new URL(backend).hostname!==process.env.STAGING_SUPABASE_DOMAIN)throw Error('Dev fixture required');
 const admin=createClient(backend,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const groupId=process.env.E2E_GROUP_ID!,userId=process.env.E2E_USER_ID!;
 const ids:string[]=[];let matchId:string|null=null;
 const readJournal=()=>page.evaluate(({group,user})=>{
  const raw=localStorage.getItem(`phyrexian-arena:web-live-game:v2:${user}:${group}`);
  return raw?JSON.parse(raw).journal:null;
 },{group:groupId,user:userId});
 try{
  await configureTracker(page);await page.evaluate(()=>localStorage.setItem('live-onboarding-v1','done'));
  await page.getByTestId('live-start').click();await expect(page.getByTestId('live-end')).toBeVisible();
  await expect.poll(async()=>(await readJournal())?.needsCreate).toBe(false);
  const previous=(await readJournal()).record;ids.push(previous.id);
  await page.getByRole('button',{name:/Reduce life for|Riduci punti vita di/}).first().click();
  await page.getByTestId('live-end').click();await page.getByTestId('live-winner').first().click();
  await page.getByTestId('live-win-last_standing').click();await page.getByTestId('live-save').click();
  await expect(page.getByRole('button',{name:/New game . same decks|Nuova partita . stessi mazzi/})).toBeVisible();
  const ended=await admin.from('live_games').select('match_id,status').eq('id',previous.id).eq('group_id',groupId).single();
  expect(ended.error).toBeNull();expect(ended.data?.status).toBe('ended');matchId=ended.data!.match_id;expect(matchId).toBeTruthy();
  const queries:URL[]=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname.endsWith('/live_game_participants'))queries.push(url);});
  await page.getByRole('button',{name:/New game . same decks|Nuova partita . stessi mazzi/}).click();
  await page.getByRole('button',{name:/^Confirm$|^Conferma$/}).click();
  await expect(page.getByTestId('live-end')).toBeVisible();
  await expect.poll(async()=>(await readJournal())?.needsCreate).toBe(false);
  const next=(await readJournal()).record;ids.push(next.id);expect(next.id).not.toBe(previous.id);
  expect(next.state.players.map((player:{participantKey:string;deckId:string})=>[player.participantKey,player.deckId]))
   .toEqual(previous.state.players.map((player:{participantKey:string;deckId:string})=>[player.participantKey,player.deckId]));
  expect(next.state.players.every((player:{life:number;infect:number;isEliminated:boolean})=>player.life===previous.starting_life&&player.infect===0&&!player.isEliminated)).toBe(true);
  expect(queries.some(url=>url.searchParams.get('live_game_id')===`neq.${previous.id}`)).toBe(true);
  const remote=await admin.from('live_games').select('id,status').eq('id',next.id).eq('group_id',groupId).single();
  expect(remote.error).toBeNull();expect(remote.data?.status).toBe('active');
 }finally{
  // Exact disposable group and round IDs only; never touch another test's history.
  if(ids.length){
   const rows=await admin.from('live_games').select('match_id').eq('group_id',groupId).in('id',ids);
   expect(rows.error).toBeNull();const matches=Array.from(new Set([matchId,...(rows.data??[]).map(row=>row.match_id)].filter((id):id is string=>Boolean(id))));
   const games=await admin.from('live_games').delete().eq('group_id',groupId).in('id',ids);expect(games.error).toBeNull();
   if(matches.length){const removed=await admin.from('matches').delete().eq('group_id',groupId).in('id',matches);expect(removed.error).toBeNull();}
  }
 }
});
