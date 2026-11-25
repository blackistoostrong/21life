import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
type Harness={render:(actor?:string,group?:string,token?:string)=>void;reads:()=>string[];
  reply:(index:number,life:number|null,deck?:string)=>void;retry:()=>void;unmount:()=>void};
declare global{interface Window{nativeSetupHarness:Harness}}
let bundle:string;
test.beforeAll(async()=>{
  const runtime=createRequire(resolve('expo/package.json'));
  const toolchain=createRequire(resolve('node_modules/vitest/package.json'));
  const {build}=await import(pathToFileURL(toolchain.resolve('vite')).href) as {build:typeof import('vitest/node').Vite.build};
  const modules:Record<string,string>={
    '@/lib/deck-image-cache':'export const prefetchDeckImageUrls=async()=>{};export const prefetchCommanderNames=async()=>{};',
    '@react-native-async-storage/async-storage':'export default {getItem:(key)=>window.nativeSetupStorage.getItem(key)};',
    '@/lib/supabase':`import {createClient} from '@supabase/supabase-js';export const supabase=createClient(location.origin,'fixture-key',{accessToken:async()=>'shared-token'});`,
  };
  const result=await build({configFile:false,root:resolve('expo'),logLevel:'error',
    define:{'process.env.NODE_ENV':JSON.stringify('production')},
    resolve:{alias:[...Object.keys(modules).map(key=>({find:key,replacement:'\0setup:'+key})),
      {find:/^react$/,replacement:runtime.resolve('react')},{find:/^react-dom\/client$/,replacement:runtime.resolve('react-dom/client')},
      {find:/^react-dom$/,replacement:runtime.resolve('react-dom')},{find:'@',replacement:resolve('expo')}]},
    plugins:[{name:'native-setup-ports',enforce:'pre',resolveId:(id,importer)=>id.startsWith('\0setup:')?id:
      id==='./env'&&importer?.endsWith('live-game-command-client.ts')?'\0setup-env':undefined,
      load:id=>id==='\0setup-env'?'export const getSupabaseUrl=()=>location.origin;export const getSupabaseAnonKey=()=>"fixture-key";':modules[id.replace('\0setup:','')]}],
    build:{write:false,minify:false,lib:{entry:resolve('expo/tests/fixtures/native-live-setup.tsx'),name:'NativeSetup',formats:['iife']}}});
  const outputs=Array.isArray(result)?result:[result];
  if(outputs.length!==1||!('output'in outputs[0]))throw Error('Unexpected setup bundle');
  bundle=outputs[0].output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n');
});
async function open(page:Page){
  await page.route('**/__native_setup',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/__native_setup.js"></script>'}));
  await page.route('**/__native_setup.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
  await page.goto('/__native_setup');await page.evaluate(()=>window.nativeSetupHarness.render());
  await expect.poll(()=>page.evaluate(()=>window.nativeSetupHarness.reads().length)).toBe(1);
}
async function state(page:Page){return JSON.parse(await page.getByTestId('setup-state').innerText()) as {ready:string|null;life:number;error:boolean;actorDecks:string[];selected:string[]};}
test('native setup isolates pending reads through A to B to A',async({page})=>{
  await open(page);await page.evaluate(()=>window.nativeSetupHarness.render('b'));
  await expect.poll(()=>page.evaluate(()=>window.nativeSetupHarness.reads().length)).toBe(2);
  await page.evaluate(()=>window.nativeSetupHarness.reply(1,25));
  await expect.poll(()=>state(page)).toMatchObject({ready:'b:g',life:25});
  await page.evaluate(()=>window.nativeSetupHarness.render('a'));
  await expect.poll(()=>page.evaluate(()=>window.nativeSetupHarness.reads().length)).toBe(3);
  await page.evaluate(()=>window.nativeSetupHarness.reply(0,60));
  await expect.poll(()=>state(page)).toMatchObject({ready:null,life:40});
  await page.evaluate(()=>window.nativeSetupHarness.reply(2,30));
  await expect.poll(()=>state(page)).toMatchObject({ready:'a:g',life:30});
});
test('native setup drops a late deck response and binds its lookup to the original account',async({page})=>{
  await open(page);let release!:()=>Promise<void>;let bearer='';
  await page.route('**/rest/v1/decks?**',route=>{
    bearer=route.request().headers().authorization;
    release=()=>route.fulfill({json:[{id:'private-a',user_id:'a',name:'Private A',commander:'Commander',commander_image:null,source_type:'occasional'}]});
  });
  await page.evaluate(()=>window.nativeSetupHarness.reply(0,60,'private-a'));
  await expect.poll(()=>Boolean(release)).toBe(true);
  await page.evaluate(()=>window.nativeSetupHarness.render('b'));
  await expect.poll(()=>page.evaluate(()=>window.nativeSetupHarness.reads().length)).toBe(2);
  await page.evaluate(()=>window.nativeSetupHarness.reply(1,null));
  await expect.poll(()=>state(page)).toMatchObject({ready:'b:g',life:40});
  await release();
  await expect.poll(()=>state(page)).toMatchObject({ready:'b:g',life:40,actorDecks:[]});
  expect(bearer).toBe('Bearer token-a');
});
test('native setup survives token renewal and starts a fresh read on group change',async({page})=>{
  await open(page);await page.evaluate(()=>window.nativeSetupHarness.reply(0,25));
  await expect.poll(()=>state(page)).toMatchObject({ready:'a:g',life:25});
  await page.evaluate(()=>window.nativeSetupHarness.render('a','g','renewed-token'));
  expect(await page.evaluate(()=>window.nativeSetupHarness.reads().length)).toBe(1);
  await expect.poll(()=>state(page)).toMatchObject({ready:'a:g',life:25});
  await page.evaluate(()=>window.nativeSetupHarness.render('a','other','renewed-token'));
  await expect.poll(()=>page.evaluate(()=>window.nativeSetupHarness.reads().length)).toBe(2);
  await expect.poll(()=>state(page)).toMatchObject({ready:null,life:40});
  await page.evaluate(()=>window.nativeSetupHarness.reply(1,30));
  await expect.poll(()=>state(page)).toMatchObject({ready:'a:other',life:30});
});

test('native setup restores valid occasional decks and preserves seat selection',async({page})=>{
  await open(page);
  await page.route('**/rest/v1/decks?**',route=>route.fulfill({json:[{id:'private-a',user_id:'a',name:'Private A',commander:'Commander',commander_image:null,source_type:'occasional'}]}));
  await page.evaluate(()=>window.nativeSetupHarness.reply(0,60,'private-a'));
  await expect.poll(()=>state(page)).toMatchObject({ready:'a:g',life:60,selected:['user:a'],actorDecks:['private-a']});
});

test('native setup shows deck restore errors and retries without starting a game',async({page})=>{
  await open(page);
  await page.route('**/rest/v1/decks?**',route=>route.fulfill({status:403,json:{code:'42501',message:'permission denied'}}));
  await page.evaluate(()=>window.nativeSetupHarness.reply(0,60,'private-a'));
  await expect.poll(()=>state(page)).toMatchObject({ready:null,life:40,error:true,selected:[]});
  await page.evaluate(()=>window.nativeSetupHarness.retry());
  await expect.poll(()=>page.evaluate(()=>window.nativeSetupHarness.reads().length)).toBe(2);
  await page.evaluate(()=>window.nativeSetupHarness.reply(1,null));
  await expect.poll(()=>state(page)).toMatchObject({ready:'a:g',life:40,error:false,selected:[]});
});

test('native setup unmount prevents a late storage read from starting a deck lookup',async({page})=>{
  await open(page);let lookups=0;
  await page.route('**/rest/v1/decks?**',route=>{lookups++;return route.fulfill({json:[]});});
  await page.evaluate(async()=>{
    window.nativeSetupHarness.unmount();window.nativeSetupHarness.reply(0,60,'private-a');
    await new Promise(requestAnimationFrame);
  });
  expect(lookups).toBe(0);
  await expect(page.getByTestId('setup-state')).toHaveCount(0);
});
