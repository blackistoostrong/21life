import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

declare global{interface Window{nativeSessionHarness:{render:(actor?:string,group?:string,token?:string)=>void;
 stats:()=>{reads:number;joins:number;channels:number;network:number;app:number;pending:number};start:()=>Promise<void>;startPending:()=>void;
 hold:(value:boolean)=>void;release:()=>void;lateStatus:()=>void;adjust:()=>void;end:()=>void;capture:()=>number;same:(index:number)=>boolean;unmount:()=>void;}}}
let bundle:string;
test.beforeAll(async()=>{
 const runtime=createRequire(resolve('expo/package.json')),toolchain=createRequire(resolve('node_modules/vitest/package.json'));
 const {build}=await import(pathToFileURL(toolchain.resolve('vite')).href) as {build:typeof import('vitest/node').Vite.build};
 const ports=resolve('expo/tests/fixtures/native-live-session-ports.ts').replaceAll('\\','/');
 const journalPorts=resolve('expo/tests/fixtures/native-live-journal-ports.tsx').replaceAll('\\','/');
 const focus=resolve('expo/node_modules/expo-router/build/useFocusEffect.js').replaceAll('\\','/');
 const modules:Record<string,string>={
  '@/contexts/language-context':`export {useLanguage} from ${JSON.stringify(ports)};`,
  '@/contexts/toast-context':`export {useToast} from ${JSON.stringify(ports)};`,
  '@/lib/live-game-service':`export {fetchActiveLiveGame,ensureLiveGameCreated,applyQueuedLiveGameMutations,cancelLiveGame,finalizePendingLiveGame,subscribeToLiveGame} from ${JSON.stringify(ports)};`,
  '@/lib/api':'export const apiPost=async()=>{};',
  '@/lib/haptics':'export const hapticLight=async()=>{};',
  '@/lib/live-game-telemetry':'export const persistLiveGameTelemetry=async()=>{};export const recordLiveGameSyncError=()=>{};',
  '@/lib/live-game-immersive':'export const applyLiveGameImmersive=()=>{};',
  '@/lib/supabase':'export const supabase={};',
  'expo-router':`export {useFocusEffect} from ${JSON.stringify(focus)};export {useRouter} from ${JSON.stringify(ports)};`,
  'expo-crypto':'export const randomUUID=()=>crypto.randomUUID();',
  '@react-native-async-storage/async-storage':`export {storage as default} from ${JSON.stringify(journalPorts)};`,
  '@react-native-community/netinfo':`export {NetInfo as default} from ${JSON.stringify(ports)};`,
  'react-native':`export {AppState} from ${JSON.stringify(ports)};`,
 };
 const result=await build({configFile:false,root:resolve('expo'),logLevel:'error',define:{'process.env.NODE_ENV':JSON.stringify('development')},
  resolve:{alias:[...Object.keys(modules).map(key=>({find:new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`),replacement:'\0session:'+key})),
   {find:/^react$/,replacement:runtime.resolve('react')},{find:/^react-dom\/client$/,replacement:runtime.resolve('react-dom/client')},
   {find:/^react-dom$/,replacement:runtime.resolve('react-dom')},{find:'@',replacement:resolve('expo')}]},
  plugins:[{name:'native-session-boundaries',enforce:'pre',resolveId:(id,importer)=>{
    if(id.startsWith('\0session:'))return id;
    if(importer?.replaceAll('\\','/').includes('expo-router/build/useFocusEffect.js')&&['./useNavigation','./link/useLoadedNavigation'].includes(id))return '\0session-navigation';
    if(id==='./env'&&importer?.endsWith('live-game-command-client.ts'))return '\0session-env';
   },load:id=>id==='\0session-navigation'?`export {useNavigation,useOptionalNavigation} from ${JSON.stringify(journalPorts)};`:
    id==='\0session-env'?'export const getSupabaseUrl=()=>location.origin;export const getSupabaseAnonKey=()=>"fixture-public-key";':modules[id.replace('\0session:','')]}],
  build:{write:false,minify:false,lib:{entry:resolve('expo/tests/fixtures/native-live-session.tsx'),name:'NativeSession',formats:['iife']}}});
 const outputs=Array.isArray(result)?result:[result];if(outputs.length!==1||!('output'in outputs[0]))throw Error('Unexpected session fixture bundle');
 bundle=outputs[0].output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n');
});
async function open(page:Page){
 await page.route('**/__native_session',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/__native_session.js"></script>'}));
 await page.route('**/__native_session.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
 await page.goto('/__native_session');await page.evaluate(()=>window.nativeSessionHarness.render());
 await expect(page.getByTestId('native-session')).toHaveText('alice:g1:ready:empty:synced:-');
}
test('native session subscribes after creation and keeps the channel through life changes',async({page})=>{
 await open(page);await page.evaluate(()=>window.nativeSessionHarness.start());
 await expect.poll(()=>page.evaluate(()=>window.nativeSessionHarness.stats().channels)).toBe(1);
 const joins=await page.evaluate(()=>window.nativeSessionHarness.stats().joins);
 await page.evaluate(()=>window.nativeSessionHarness.adjust());
 await expect(page.getByTestId('native-session')).toContainText('game-alice-g1');
 expect((await page.evaluate(()=>window.nativeSessionHarness.stats())).joins).toBe(joins);
});
test('native session renews JWT without replacing the owner or bootstrap',async({page})=>{
 await open(page);await page.evaluate(()=>window.nativeSessionHarness.start());
 await expect.poll(()=>page.evaluate(()=>window.nativeSessionHarness.stats().channels)).toBe(1);
 const baseline=await page.evaluate(()=>({index:window.nativeSessionHarness.capture(),stats:window.nativeSessionHarness.stats()}));
 await page.evaluate(()=>window.nativeSessionHarness.render('alice','g1','renewed'));
 await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));
 expect(await page.evaluate(index=>window.nativeSessionHarness.same(index),baseline.index)).toBe(true);
 expect(await page.evaluate(()=>window.nativeSessionHarness.stats())).toEqual(baseline.stats);
});
test('native session ignores old channel status after account change',async({page})=>{
 await open(page);await page.evaluate(()=>window.nativeSessionHarness.start());
 await expect.poll(()=>page.evaluate(()=>window.nativeSessionHarness.stats().channels)).toBe(1);
 await page.evaluate(()=>window.nativeSessionHarness.render('bob'));
 await expect(page.getByTestId('native-session')).toHaveText('bob:g1:ready:empty:synced:-');
 await page.evaluate(()=>window.nativeSessionHarness.lateStatus());
 await expect(page.getByTestId('native-session')).toHaveText('bob:g1:ready:empty:synced:-');
 expect(await page.evaluate(()=>window.nativeSessionHarness.stats())).toMatchObject({channels:0,network:1,app:1});
});
test('native session rejects creation ACK after changing group',async({page})=>{
 await open(page);await page.evaluate(()=>{window.nativeSessionHarness.hold(true);window.nativeSessionHarness.startPending();});
 await expect.poll(()=>page.evaluate(()=>window.nativeSessionHarness.stats().pending)).toBe(1);
 await page.evaluate(()=>window.nativeSessionHarness.render('alice','g2'));
 await expect(page.getByTestId('native-session')).toHaveText('alice:g2:ready:empty:synced:-');
 await page.evaluate(()=>window.nativeSessionHarness.release());
 await expect(page.getByTestId('native-session')).toHaveText('alice:g2:ready:empty:synced:-');
 expect((await page.evaluate(()=>window.nativeSessionHarness.stats())).channels).toBe(0);
});
test('native session keeps terminal recap when journal cleanup removes its channel',async({page})=>{
 await open(page);await page.evaluate(()=>window.nativeSessionHarness.start());
 await page.evaluate(()=>window.nativeSessionHarness.end());
 await expect(page.getByTestId('native-session')).toHaveText('alice:g1:ready:empty:synced:game-alice-g1');
 expect((await page.evaluate(()=>window.nativeSessionHarness.stats())).channels).toBe(0);
});
test('native session releases channel and platform resources on unmount',async({page})=>{
 await open(page);await page.evaluate(()=>window.nativeSessionHarness.start());
 await page.evaluate(()=>window.nativeSessionHarness.unmount());
 expect(await page.evaluate(()=>window.nativeSessionHarness.stats())).toMatchObject({channels:0,network:0,app:0});
});
