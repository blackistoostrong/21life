import {test,expect,type Request} from '@playwright/test';
import {fixtureLogin} from './fixture-login';
import {transitionFixtureSession} from './profile-auth-fixture';

for(const resource of ['groups','arena_guests'] as const){
 test(`web live catalog cancels ${resource} when returning to the arena`,async({page})=>{
  test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
  const groupId=process.env.E2E_GROUP_ID!;
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${groupId}"]`).first().click();
  await expect(page.getByRole('button',{name:/Play Game|Gioca live/})).toBeVisible();
  const requests=new Set<Request>();let aborted=0;let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  page.on('requestfailed',request=>{if(requests.has(request))aborted++;});
  await page.route(`**/rest/v1/${resource}?*`,async route=>{
   const query=new URL(route.request().url()).searchParams;
   if(query.get(resource==='groups'?'id':'group_id')!==`eq.${groupId}`)return route.fallback();
   const select=query.get('select')??'';
   if(select.includes('profiles:created_by')||select.includes('last_played_at'))return route.fallback();
   requests.add(route.request());await pending;
   await route.fulfill({status:403,json:{code:'42501',message:'Synthetic denied read'}}).catch(()=>{});
  });
  try{
   await page.getByRole('button',{name:/Play Game|Gioca live/}).click();
   await expect(page).toHaveURL(new RegExp(`/table/${groupId}/play$`));
   await expect.poll(()=>requests.size).toBeGreaterThan(0);
   await page.goBack();
   await expect(page).toHaveURL(new RegExp(`/table/${groupId}$`));
   await expect.poll(()=>aborted).toBe(requests.size);
  }finally{release();}
 });
}

test('web live catalog cancels the old account read on an authenticated transition',async({page})=>{
 test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
 const groupId=process.env.E2E_GROUP_ID!;
 await fixtureLogin(page);
 await page.locator(`a[href="/table/${groupId}"]`).first().click();
 await expect(page.getByRole('button',{name:/Play Game|Gioca live/})).toBeVisible();
 const requests=new Set<Request>();let aborted=0;let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 page.on('requestfailed',request=>{if(requests.has(request))aborted++;});
 await page.route('**/rest/v1/arena_guests?*',async route=>{
  const query=new URL(route.request().url()).searchParams;
  if(query.get('group_id')!==`eq.${groupId}`||(query.get('select')??'').includes('last_played_at'))return route.fallback();
  // Hold only the original actor. The replacement actor must start its own read.
  if(requests.size)return route.fallback();
  requests.add(route.request());await pending;
  await route.fulfill({status:403,json:{message:'Synthetic denied read'}}).catch(()=>{});
 });
 try{
  await page.getByRole('button',{name:/Play Game|Gioca live/}).click();
  await expect.poll(()=>requests.size).toBe(1);
  await transitionFixtureSession(page,true);
  await expect.poll(()=>aborted).toBe(1);
  await expect(page.getByRole('heading',{name:/Set up the game|Configura la partita/})).toBeVisible();
 }finally{release();}
});

test('web live catalog exposes a failed cold read and allows a successful retry',async({page})=>{
 test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
 const groupId=process.env.E2E_GROUP_ID!;
 await fixtureLogin(page);
 await page.locator(`a[href="/table/${groupId}"]`).first().click();
 await expect(page.getByRole('button',{name:/Play Game|Gioca live/})).toBeVisible();
 let deny=true;
 await page.route('**/rest/v1/arena_guests?*',route=>{
  const query=new URL(route.request().url()).searchParams;
  if(!deny||query.get('group_id')!==`eq.${groupId}`||(query.get('select')??'').includes('last_played_at'))return route.fallback();
  return route.fulfill({status:403,json:{message:'Synthetic denied read'}});
 });
 await page.getByRole('button',{name:/Play Game|Gioca live/}).click();
 await expect(page.getByRole('alert')).toContainText(/Could not load this arena|Impossibile caricare/);
 await expect(page.getByRole('heading',{name:/Set up the game|Configura la partita/})).toHaveCount(0);
 deny=false;
 await page.getByRole('button',{name:/^Retry$|^Riprova$/}).click();
 await expect(page.getByRole('heading',{name:/Set up the game|Configura la partita/})).toBeVisible();
});

test('web live catalog keeps the setup draft without reloading on JWT renewal',async({page})=>{
 test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
 const groupId=process.env.E2E_GROUP_ID!;
 await fixtureLogin(page);
 await page.locator(`a[href="/table/${groupId}"]`).first().click();
 await page.getByRole('button',{name:/Play Game|Gioca live/}).click();
 await expect(page.getByRole('heading',{name:/Set up the game|Configura la partita/})).toBeVisible();
 await page.getByRole('button',{name:/Step 4|Passaggio 4/}).click();
 await expect(page.getByRole('button',{name:/^(Seat|Posto) 1/})).toBeVisible();
 let reads=0;
 await page.route('**/rest/v1/groups?*',route=>{
  const query=new URL(route.request().url()).searchParams;
  if(query.get('id')===`eq.${groupId}`&&!(query.get('select')??'').includes('profiles:created_by'))reads++;
  return route.fallback();
 });
 await transitionFixtureSession(page);
 await expect(page.getByRole('button',{name:/^(Seat|Posto) 1/})).toBeVisible();
 expect(reads).toBe(0);
});
