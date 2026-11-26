import {test,expect,type Request,type Page} from '@playwright/test';
import {fixtureLogin} from './fixture-login';
import {transitionFixtureSession} from './profile-auth-fixture';

async function configureTracker(page:Page){
  const groupId=process.env.E2E_GROUP_ID!;
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${groupId}"]`).first().click();
  await page.getByRole('button',{name:/Play Game|Gioca live/}).click();
  await page.getByRole('button',{name:'2',exact:true}).click();
  await page.getByRole('button',{name:/Step 4|Passaggio 4/}).click();
  for(let seat=1;seat<=2;seat++){
    await page.getByRole('button',{name:new RegExp(`^(Seat|Posto) ${seat}`)}).click();
    const select=page.getByTestId('live-player-select');
    const option=select.locator('option:not([disabled])').filter({hasNotText:/Choose player|Scegli giocatore/}).first();
    await select.selectOption((await option.getAttribute('value'))!);
    await page.getByTestId('live-deck-option').first().click();
  }
  return groupId;
}

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
