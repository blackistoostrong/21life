import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
type Snapshot={calls:string[];reads:number;network:number;app:number};
type Harness={render:(actor?:string,token?:string)=>void;snapshot:()=>Snapshot;clear:()=>void;reply:(index:number)=>void;
 offline:()=>void;background:()=>void;unmount:()=>void};
declare global{interface Window{liveConnectivityHarness:Harness}}
let bundle:string;
test.beforeAll(async()=>{
 const runtime=createRequire(resolve('expo/package.json')),toolchain=createRequire(resolve('node_modules/vitest/package.json'));
 const {build}=await import(pathToFileURL(toolchain.resolve('vite')).href) as {build:typeof import('vitest/node').Vite.build};
 const modules:Record<string,string>={
  '@react-native-community/netinfo':'export default {addEventListener:fn=>window.liveOSPorts.network(fn),fetch:()=>window.liveOSPorts.fetch()};',
  'react-native':'export const AppState={addEventListener:(_name,fn)=>window.liveOSPorts.state(fn)};',
  '@/lib/live-game-immersive':'export const applyLiveGameImmersive=()=>window.liveOSPorts.immersive();',
  '@/lib/live-game-telemetry':'export const persistLiveGameTelemetry=async(client,payload)=>{await client.rpc("lifecycle_probe",{});window.liveOSPorts.telemetry(payload.userId);};',
  '@/lib/supabase':'import {createClient} from "@supabase/supabase-js";export const supabase=createClient(location.origin,"fixture-key",{accessToken:async()=>"global-token"});',
 };
 const result=await build({configFile:false,root:resolve('expo'),logLevel:'error',define:{'process.env.NODE_ENV':JSON.stringify('production')},
  resolve:{alias:[...Object.keys(modules).map(key=>({find:key,replacement:'\0os:'+key})),{find:/^react$/,replacement:runtime.resolve('react')},
   {find:/^react-dom\/client$/,replacement:runtime.resolve('react-dom/client')},{find:/^react-dom$/,replacement:runtime.resolve('react-dom')},
   {find:'@',replacement:resolve('expo')}]},
  plugins:[{name:'live-os-ports',enforce:'pre',resolveId:(id,importer)=>id.startsWith('\0os:')?id:
   id==='./env'&&importer?.endsWith('live-game-command-client.ts')?'\0os-env':undefined,
   load:id=>id==='\0os-env'?'export const getSupabaseUrl=()=>location.origin;export const getSupabaseAnonKey=()=>"fixture-key";':modules[id.replace('\0os:','')]}],
  build:{write:false,minify:false,lib:{entry:resolve('expo/tests/fixtures/native-live-connectivity.tsx'),name:'LiveOS',formats:['iife']}}});
 const outputs=Array.isArray(result)?result:[result];if(outputs.length!==1||!('output'in outputs[0]))throw Error('Unexpected OS bundle');
 bundle=outputs[0].output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n');
});
async function open(page:Page){
 await page.clock.install();
 await page.route('**/__live_os',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/__live_os.js"></script>'}));
 await page.route('**/__live_os.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
 await page.goto('/__live_os');await page.evaluate(()=>window.liveConnectivityHarness.render());
 await expect(page.getByTestId('connectivity')).toHaveText('a:true');
}
test('native connectivity does not dispatch a late NetInfo read after unmount',async({page})=>{
 await open(page);await page.clock.runFor(10000);
 expect((await page.evaluate(()=>window.liveConnectivityHarness.snapshot())).reads).toBe(1);
 await page.evaluate(()=>{window.liveConnectivityHarness.unmount();window.liveConnectivityHarness.clear();});
 await page.evaluate(async()=>{window.liveConnectivityHarness.reply(0);await Promise.resolve();await Promise.resolve();});
 expect(await page.evaluate(()=>window.liveConnectivityHarness.snapshot())).toMatchObject({calls:[],network:0,app:0});
 await page.clock.runFor(30000);
 expect((await page.evaluate(()=>window.liveConnectivityHarness.snapshot())).reads).toBe(1);
});
test('native connectivity ignores an old account read and owns one pair of platform listeners',async({page})=>{
 await open(page);await page.clock.runFor(10000);
 await page.evaluate(()=>window.liveConnectivityHarness.render('b','token-b'));
 await expect(page.getByTestId('connectivity')).toHaveText('b:true');
 await page.evaluate(async()=>{window.liveConnectivityHarness.clear();window.liveConnectivityHarness.reply(0);await Promise.resolve();await Promise.resolve();});
 expect(await page.evaluate(()=>window.liveConnectivityHarness.snapshot())).toMatchObject({calls:[],network:1,app:1});
 await page.evaluate(()=>window.liveConnectivityHarness.offline());
 await expect(page.getByTestId('connectivity')).toHaveText('b:false');
});
test('native background telemetry uses the current captured bearer after token renewal',async({page})=>{
 await open(page);let bearer='';
 await page.route('**/rest/v1/rpc/lifecycle_probe',route=>{bearer=route.request().headers().authorization;return route.fulfill({json:true});});
 await page.evaluate(()=>window.liveConnectivityHarness.render('a','renewed-token'));
 await page.evaluate(()=>window.liveConnectivityHarness.background());
 await expect.poll(()=>bearer).toBe('Bearer renewed-token');
 expect(await page.evaluate(()=>window.liveConnectivityHarness.snapshot())).toMatchObject({network:1,app:1});
});
test('native connectivity keeps one pending NetInfo read across overlapping interval ticks',async({page})=>{
 await open(page);await page.clock.runFor(30000);
 expect((await page.evaluate(()=>window.liveConnectivityHarness.snapshot())).reads).toBe(1);
 await page.evaluate(async()=>{window.liveConnectivityHarness.reply(0);await Promise.resolve();await Promise.resolve();});
 await expect.poll(()=>page.evaluate(()=>window.liveConnectivityHarness.snapshot().calls)).toEqual(['sync','resume','retry']);
 await page.clock.runFor(10000);
 expect((await page.evaluate(()=>window.liveConnectivityHarness.snapshot())).reads).toBe(2);
});
