import { expect, test } from '@playwright/test';
import { analyticsDashboardFixture } from '../fixtures/analytics-dashboard';
import { fixtureLogin } from './fixture-login';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

test('analytics v2 refuses incomplete data and retries without a facts fallback',async({ page })=>{
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1','Requires a disposable authenticated backend.');
  let valid=false;
  const legacyCalls: string[]=[];
  page.on('request',request=>{ if (/\/rpc\/get_(personal|global)_analytics_facts/.test(request.url())) legacyCalls.push(request.url()); });
  await page.route('**/rest/v1/rpc/get_personal_analytics_dashboard_v2',route=>route.fulfill({
    status: 200,json: { ...analyticsDashboardFixture(),schemaVersion: valid ? 2 : 1 },
  }));
  await fixtureLogin(page);
  await expect(page.getByText('Statistics unavailable. Partial results are not displayed.',{ exact: true })).toBeVisible();
  await expect(page.getByRole('heading',{ name: 'No personal data yet',exact: true })).toHaveCount(0);
  valid=true;
  await page.getByRole('button',{ name: 'Retry',exact: true }).click();
  const section=page.getByRole('heading',{ name: 'Personal Analytics',exact: true }).locator('xpath=ancestor::section[1]');
  await expect(section.getByText('50% win',{ exact: true })).toBeVisible();
  await expect(page.getByText('Statistics unavailable. Partial results are not displayed.',{ exact: true })).toHaveCount(0);
  expect(legacyCalls).toEqual([]);
});

test('analytics v2 cancels its owned request when navigating away',async({ page })=>{
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1','Requires a disposable authenticated backend.');
  let requests=0;
  let cancelled=0;
  const releases=new Set<()=>void>();
  page.on('requestfailed',request=>{ if (request.url().includes('/rpc/get_personal_analytics_dashboard_v2')) cancelled+=1; });
  await page.route('**/rest/v1/rpc/get_personal_analytics_dashboard_v2',async route=>{
    requests+=1;
    await new Promise<void>(resolve=>releases.add(resolve));
    try { await route.fulfill({ status: 200,json: analyticsDashboardFixture() }); }
    catch(error) { if (cancelled===0) throw error; }
  });
  try {
    await fixtureLogin(page);
    await expect.poll(()=>requests).toBeGreaterThan(0);
    await page.getByRole('banner').getByRole('button',{ name: 'Profile',exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect.poll(()=>cancelled).toBe(requests);
  } finally { releases.forEach(release=>release()); }
});

test('profile v2 reports backend errors and retries with neutral draws',async({page})=>{
  test.skip(process.env.E2E_ANALYTICS_FLOW!=='1','Requires disposable authentication.');
  const userId=process.env.E2E_USER_ID!;
  const deckId='00000000-0000-4000-8000-000000000001';
  let valid=false;const legacy:string[]=[];
  page.on('request',request=>{
    if(/\/rest\/v1\/match_participants\?/.test(request.url()) || /\/rpc\/get_profile_deck_performance$/.test(request.url())) legacy.push(request.url());
  });
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2',route=>route.fulfill({status:200,json:{
    schemaVersion:2,scope:'personal',userId,revision:'a'.repeat(32),total:1,next:null,
    decks:[{id:deckId,user_id:userId,group_id:null,name:'DEV26 profile metric fixture',commander:'Atraxa, Praetors’ Voice',
      commander_image:'https://cards.scryfall.io/normal/front/0/0/00000000-0000-4000-8000-000000000001.jpg',
      commander_cmc:4,commander_options:[],color_identity:['W','U','B','G'],bracket:'3',source_type:'manual',source_url:null,
      is_favorite:false,is_archived:false,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}],
  }}));
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2',route=>{
    const report=profileCatalogFixture();report.userId=userId;report.decks[0].deck_id=deckId;
    return route.fulfill({status:200,json:{...report,complete:valid}});
  });
  await fixtureLogin(page);
  await page.getByRole('banner').getByRole('button',{name:'Profile',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Statistics unavailable.'})).toBeVisible();
  const card=page.getByRole('region',{name:'Your player card'});
  await expect(card.getByText('—',{exact:true})).toHaveCount(2);
  valid=true;
  await page.getByRole('alert').filter({hasText:'Statistics unavailable.'}).getByRole('button',{name:'Retry',exact:true}).click();
  await expect(card.getByText('50%',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText:'Statistics unavailable.'})).toHaveCount(0);
  expect(legacy).toEqual([]);
  await page.locator('[data-web-card]').filter({has:page.getByRole('heading',{
    name:'DEV26 profile metric fixture',exact:true,
  })}).getByRole('button',{name:'Details',exact:true}).click();
  const chart=page.getByRole('img',{name:'Wins 1, draws 1, losses 1. Win rate 50%.',exact:true});
  await expect(chart).toBeVisible();
  await expect(chart.locator('.recharts-pie-sector')).toHaveCount(3);
  const sectors=await chart.locator('.recharts-sector').evaluateAll(elements=>elements.map(element=>({
    fill:element.getAttribute('fill'),path:element.getAttribute('d'),
  })));
  expect(sectors.map(sector=>sector.fill)).toEqual(['#34d399','#22d3ee','#64748b']);
  expect(sectors.every(sector=>sector.path&&!/NaN|Infinity/.test(sector.path))).toBe(true);
  await chart.screenshot({path:`artifacts/dev26/recharts-profile-${test.info().project.name}.png`});
});

test('profile catalog requires every page and retries without exposing a partial collection',async({page})=>{
  test.skip(process.env.E2E_ANALYTICS_FLOW!=='1','Requires disposable authentication.');
  const userId=process.env.E2E_USER_ID!;
  const revision='b'.repeat(32);
  const decks=Array.from({length:251},(_,index)=>({
    id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,user_id:userId,group_id:null,
    name:`Catalog fixture ${index+1}`,commander:'Catalog commander',commander_image:null,commander_cmc:4,
    commander_options:[],color_identity:['U'],bracket:'3',source_type:'manual',source_url:null,
    is_favorite:false,is_archived:false,created_at:'2026-01-01T00:00:00Z',updated_at:null,
  }));
  let allowTail=false;
  let tailPending=false;
  let releaseTail:()=>void=()=>{};
  const requests:Array<{p_after:string|null;p_revision:string|null}>=[];
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2',async route=>{
    const body=route.request().postDataJSON();requests.push(body);
    if(body.p_after&&!allowTail)return route.fulfill({status:503,json:{message:'Synthetic tail unavailable'}});
    if(body.p_after){tailPending=true;await new Promise<void>(resolve=>{releaseTail=resolve;});}
    return route.fulfill({status:200,json:{schemaVersion:2,scope:'personal',userId,revision,total:decks.length,
      decks:body.p_after?decks.slice(250):decks.slice(0,250),next:body.p_after?null:decks[249].id,
    }});
  });
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2',route=>{
    const report=profileCatalogFixture();report.userId=userId;report.total=decks.length;
    report.decks=decks.map(deck=>({...report.decks[0],deck_id:deck.id}));
    return route.fulfill({status:200,json:report});
  });
  await fixtureLogin(page);
  await page.getByRole('banner').getByRole('button',{name:'Profile',exact:true}).click();
  const error=page.getByRole('alert').filter({hasText:'Catalog unavailable. Please retry.'});
  await expect(error).toBeVisible();
  await expect(page.getByRole('heading',{name:'Catalog fixture 1',exact:true})).toHaveCount(0);
  expect(requests[1]).toMatchObject({p_after:decks[249].id,p_revision:revision});
  allowTail=true;
  await error.getByRole('button',{name:'Retry',exact:true}).click();
  try {
    await expect.poll(()=>tailPending).toBe(true);
    await expect(page.getByText('Loading profile...',{exact:true})).toBeVisible();
  } finally {releaseTail();}
  await expect(error).toHaveCount(0);
  await page.getByPlaceholder('Search by name or commander...').fill('Catalog fixture 251');
  await expect(page.getByRole('heading',{name:'Catalog fixture 251',exact:true})).toBeVisible();
  expect(requests.at(-2)).toMatchObject({p_after:null,p_revision:null});
  expect(requests.at(-1)).toMatchObject({p_after:decks[249].id,p_revision:revision});
});

test('profile metadata cancels owned CMC on navigation before any late write',async({page})=>{
  test.skip(process.env.E2E_ANALYTICS_FLOW!=='1','Requires disposable authentication.');
  const userId=process.env.E2E_USER_ID!;
  const deckId='00000000-0000-4000-8000-000000000001';
  let pending=0;let cancelled=0;let writes=0;
  const releases=new Set<()=>void>();
  page.on('requestfailed',request=>{if(request.url().includes('/api/scryfall-commander-cmc'))cancelled+=1;});
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2',route=>route.fulfill({status:200,json:{
    schemaVersion:2,scope:'personal',userId,revision:'d'.repeat(32),total:1,next:null,
    decks:[{id:deckId,user_id:userId,group_id:null,name:'Cancel metadata fixture',commander:'Catalog commander',
      commander_image:null,commander_cmc:null,commander_options:[],color_identity:['U'],bracket:'3',
      source_type:'manual',source_url:null,is_favorite:false,is_archived:false,created_at:'2026-01-01T00:00:00Z',updated_at:null}],
  }}));
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2',route=>{
    const report=profileCatalogFixture();report.userId=userId;report.decks[0].deck_id=deckId;
    return route.fulfill({status:200,json:report});
  });
  await page.route('**/api/scryfall-commander-cmc',async route=>{
    pending+=1;
    await new Promise<void>(resolve=>releases.add(resolve));
    try {await route.fulfill({status:200,json:{cmcs:{'Catalog commander':4}}});}
    catch(error){if(cancelled===0)throw error;}
  });
  await page.route('**/rest/v1/decks?*',route=>{
    if(route.request().method()!=='PATCH')return route.continue();
    writes+=1;return route.fulfill({status:204});
  });
  try {
    await fixtureLogin(page);
    for(let round=1;round<=2;round+=1){
      await page.getByRole('banner').getByRole('button',{name:'Profile',exact:true}).click();
      await expect.poll(()=>pending).toBe(round);
      await page.getByRole('button',{name:'Back to home',exact:true}).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect.poll(()=>cancelled).toBe(round);
      expect(writes).toBe(0);
    }
  } finally {releases.forEach(release=>release());}
});

test('profile metadata releases queued idle work on navigation',async({page})=>{
  test.skip(process.env.E2E_ANALYTICS_FLOW!=='1','Requires disposable authentication.');
  await page.addInitScript(()=>{
    const probe=window as typeof window&{__dev26MetadataIdle?:number};
    probe.__dev26MetadataIdle=0;
    const pending=new Set<number>();let serial=900_000;
    const request=window.requestIdleCallback.bind(window),cancel=window.cancelIdleCallback.bind(window);
    window.requestIdleCallback=(callback,options)=>{
      if(options?.timeout!==6000)return request(callback,options);
      const id=++serial;pending.add(id);probe.__dev26MetadataIdle=pending.size;return id;
    };
    window.cancelIdleCallback=id=>{
      if(pending.delete(id))probe.__dev26MetadataIdle=pending.size;
      else cancel(id);
    };
  });
  const userId=process.env.E2E_USER_ID!;
  const deckId='00000000-0000-4000-8000-000000000001';
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2',route=>route.fulfill({status:200,json:{
    schemaVersion:2,scope:'personal',userId,revision:'e'.repeat(32),total:1,next:null,
    decks:[{id:deckId,user_id:userId,group_id:null,name:'Queued metadata fixture',commander:'Catalog commander',
      commander_image:null,commander_cmc:null,commander_options:[],color_identity:['U'],bracket:'3',
      source_type:'manual',source_url:null,is_favorite:false,is_archived:false,created_at:'2026-01-01T00:00:00Z',updated_at:null}],
  }}));
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2',route=>{
    const report=profileCatalogFixture();report.userId=userId;report.decks[0].deck_id=deckId;
    return route.fulfill({status:200,json:report});
  });
  const pending=()=>page.evaluate(()=>(window as typeof window&{__dev26MetadataIdle?:number}).__dev26MetadataIdle??0);
  await fixtureLogin(page);
  for(let round=0;round<2;round+=1){
    await page.getByRole('banner').getByRole('button',{name:'Profile',exact:true}).click();
    await expect.poll(pending).toBe(1);
    await page.getByRole('button',{name:'Back to home',exact:true}).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect.poll(pending).toBe(0);
  }
});

test('profile catalog enriches missing commander CMC once without replacing the collection',async({page})=>{
  test.skip(process.env.E2E_ANALYTICS_FLOW!=='1','Requires disposable authentication.');
  const userId=process.env.E2E_USER_ID!;
  const deckId='00000000-0000-4000-8000-000000000001';
  const patches:unknown[]=[];const lookups:unknown[]=[];
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2',route=>route.fulfill({status:200,json:{
    schemaVersion:2,scope:'personal',userId,revision:'c'.repeat(32),total:1,next:null,
    decks:[{id:deckId,user_id:userId,group_id:null,name:'Enrichment fixture',commander:'Catalog commander',
      commander_image:null,commander_cmc:null,commander_options:[],color_identity:['U'],bracket:'3',
      source_type:'manual',source_url:null,is_favorite:false,is_archived:false,created_at:'2026-01-01T00:00:00Z',updated_at:null}],
  }}));
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2',route=>{
    const report=profileCatalogFixture();report.userId=userId;report.decks[0].deck_id=deckId;
    return route.fulfill({status:200,json:report});
  });
  await page.route('**/api/scryfall-commander-cmc',route=>{
    lookups.push(route.request().postDataJSON());
    return route.fulfill({status:200,json:{cmcs:{'Catalog commander':4}}});
  });
  await page.route('**/rest/v1/decks?*',route=>{
    if(route.request().method()!=='PATCH')return route.continue();
    expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${deckId}`);
    patches.push(route.request().postDataJSON());
    return route.fulfill({status:204});
  });
  await fixtureLogin(page);
  await page.getByRole('banner').getByRole('button',{name:'Profile',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Enrichment fixture',exact:true})).toBeVisible();
  await expect.poll(()=>patches).toEqual([{commander_cmc:4}]);
  await page.getByPlaceholder('Search by name or commander...').fill('Enrichment fixture');
  await expect(page.getByRole('heading',{name:'Enrichment fixture',exact:true})).toBeVisible();
  expect(lookups).toEqual([{names:['Catalog commander']}]);
});

test('profile collection preserves favorite priority, search, colors and metric sorting', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const userId = process.env.E2E_USER_ID!;
  const decks = [
    { name: 'Collection Alpha', color: 'U', favorite: true, date: '2026-01-01', games: 3 },
    { name: 'Collection Beta', color: 'R', favorite: false, date: '2026-01-02', games: 10 },
    { name: 'Collection Gamma', color: 'U', favorite: false, date: '2026-01-03', games: 6 },
  ].map((entry, index) => ({ ...entry, id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}` }));
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => route.fulfill({ status: 200, json: {
    schemaVersion: 2, scope: 'personal', userId, revision: 'c'.repeat(32), total: decks.length, next: null,
    decks: decks.map(deck => ({ id: deck.id, user_id: userId, group_id: null, name: deck.name,
      commander: `${deck.name} commander`, commander_image: null, commander_cmc: 4,
      commander_options: [], color_identity: [deck.color], bracket: '3', source_type: 'manual', source_url: null,
      is_favorite: deck.favorite, is_archived: false, created_at: `${deck.date}T00:00:00Z`, updated_at: null })),
  } }));
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2', route => {
    const report = profileCatalogFixture(); report.userId = userId; report.total = decks.length;
    report.decks = decks.map(deck => ({ ...report.decks[0], deck_id: deck.id, games_played: deck.games }));
    return route.fulfill({ status: 200, json: report });
  });
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => route.fulfill({ status: 403 }));
  await page.route('**/api/edhrec-*', route => route.fulfill({ status: 404, json: {} }));
  await fixtureLogin(page);
  await page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true }).click();
  const grid = page.locator('.web-deck-grid');
  const names = grid.locator('h3');
  await expect(names).toHaveText(['Collection Alpha', 'Collection Gamma', 'Collection Beta']);
  await page.getByRole('combobox', { name: 'Sort decks', exact: true }).click();
  await page.getByRole('option', { name: 'Games played', exact: true }).click();
  await expect(names).toHaveText(['Collection Alpha', 'Collection Beta', 'Collection Gamma']);
  const colors = page.locator('[aria-label="Filter by colors"]');
  await colors.getByRole('button', { name: 'U', exact: true }).click();
  await expect(names).toHaveText(['Collection Alpha', 'Collection Gamma']);
  const search = page.getByPlaceholder('Search by name or commander...', { exact: true });
  await search.fill('Gamma commander');
  await expect(names).toHaveText(['Collection Gamma']);
  await search.clear();
  await colors.getByRole('button', { name: 'All', exact: true }).click();
  await expect(names).toHaveText(['Collection Alpha', 'Collection Beta', 'Collection Gamma']);
  const phase = process.env.E2E_COLLECTION_CAPTURE;
  if (phase === 'before' || phase === 'after') {
    await page.evaluate(() => document.fonts.ready);
    await grid.screenshot({ path: `artifacts/dev26/collection-${phase}-${test.info().project.name}.png`, animations: 'disabled' });
  }
});
