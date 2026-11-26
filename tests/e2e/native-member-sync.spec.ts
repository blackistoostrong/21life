import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
type Harness={render:(actor?:string,group?:string,token?:string)=>void;select:(key?:string)=>void;retry:()=>void;
 calls:()=>Array<{body:unknown;bearer?:string;aborted:boolean}>;refreshes:()=>number;reply:(index:number,skipped?:number)=>void;
 refresh:(index:number,outcome:'ok'|'error')=>void;unmount:()=>void};
declare global{interface Window{memberSyncHarness:Harness}}
let bundle:string;
test.beforeAll(async()=>{
 const runtime=createRequire(resolve('expo/package.json')),toolchain=createRequire(resolve('node_modules/vitest/package.json'));
 const {build}=await import(pathToFileURL(toolchain.resolve('vite')).href) as {build:typeof import('vitest/node').Vite.build};
 const result=await build({configFile:false,root:resolve('expo'),logLevel:'error',define:{'process.env.NODE_ENV':JSON.stringify('production')},
  resolve:{alias:[{find:'@/lib/api',replacement:'\0member-api'}, {find:/^react$/,replacement:runtime.resolve('react')},
   {find:/^react-dom\/client$/,replacement:runtime.resolve('react-dom/client')},{find:/^react-dom$/,replacement:runtime.resolve('react-dom')},
   {find:'@',replacement:resolve('expo')}]},
  plugins:[{name:'member-ports',enforce:'pre',resolveId:(id,importer)=>id==='\0member-api'?id:
   id==='./env'&&importer?.endsWith('live-game-command-client.ts')?'\0member-env':undefined,
   load:id=>id==='\0member-api'?'export const apiPost=(...args)=>window.memberSyncPort.post(...args);':
    id==='\0member-env'?'export const getSupabaseUrl=()=>location.origin;export const getSupabaseAnonKey=()=>"fixture-key";':undefined}],
  build:{write:false,minify:false,lib:{entry:resolve('expo/tests/fixtures/native-member-sync.tsx'),name:'NativeMember',formats:['iife']}}});
 const outputs=Array.isArray(result)?result:[result];if(outputs.length!==1||!('output'in outputs[0]))throw Error('Unexpected member bundle');
 bundle=outputs[0].output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n');
});
async function open(page:Page){
 await page.route('**/__member',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/__member.js"></script>'}));
 await page.route('**/__member.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
 await page.goto('/__member');await page.evaluate(()=>window.memberSyncHarness.render());
}
async function state(page:Page){return JSON.parse(await page.getByTestId('member-sync').innerText()) as {actor:string;state:null|{status:string;userId:string;skipped?:number;requestId?:string}};}
test('native member import drops old account progress and does not refresh after a late response',async({page})=>{
 await open(page);await page.evaluate(()=>window.memberSyncHarness.select());
 await expect.poll(()=>page.evaluate(()=>window.memberSyncHarness.calls().length)).toBe(1);
 await page.evaluate(()=>window.memberSyncHarness.render('b'));
 await expect.poll(()=>state(page)).toEqual({actor:'b',state:null});
 expect((await page.evaluate(()=>window.memberSyncHarness.calls()))[0]).toMatchObject({bearer:'Bearer token-a',aborted:true});
 await page.evaluate(async()=>{window.memberSyncHarness.reply(0);await new Promise(requestAnimationFrame);});
 expect(await page.evaluate(()=>window.memberSyncHarness.refreshes())).toBe(0);
});
test('native member import excludes duplicate taps and keeps the same job across token renewal',async({page})=>{
 await open(page);await page.evaluate(()=>{window.memberSyncHarness.select();window.memberSyncHarness.select();});
 expect(await page.evaluate(()=>window.memberSyncHarness.calls().length)).toBe(1);
 await page.evaluate(()=>window.memberSyncHarness.render('a','g','renewed'));
 await page.evaluate(()=>window.memberSyncHarness.reply(0));
 await expect.poll(()=>page.evaluate(()=>window.memberSyncHarness.refreshes())).toBe(1);
 await page.evaluate(()=>window.memberSyncHarness.refresh(0,'ok'));
 await expect.poll(()=>state(page)).toMatchObject({state:{status:'completed'}});
});
test('native member retry refreshes a confirmed partial import without another POST',async({page})=>{
 await open(page);await page.evaluate(()=>{window.memberSyncHarness.select();window.memberSyncHarness.reply(0,2);});
 await expect.poll(()=>page.evaluate(()=>window.memberSyncHarness.refreshes())).toBe(1);
 await page.evaluate(()=>window.memberSyncHarness.refresh(0,'error'));
 await expect.poll(()=>state(page)).toMatchObject({state:{status:'refresh_failed',skipped:2}});
 await page.evaluate(()=>{window.memberSyncHarness.retry();window.memberSyncHarness.retry();});
 await expect.poll(()=>page.evaluate(()=>window.memberSyncHarness.refreshes())).toBe(2);
 expect(await page.evaluate(()=>window.memberSyncHarness.calls().length)).toBe(1);
 await page.evaluate(()=>window.memberSyncHarness.refresh(1,'ok'));
 await expect.poll(()=>state(page)).toMatchObject({state:{status:'partial',skipped:2,requestId:'123e4567-e89b-42d3-a456-426614174000'}});
});
test('native member import clears on group change and aborts on unmount',async({page})=>{
 await open(page);await page.evaluate(()=>window.memberSyncHarness.select());
 await page.evaluate(()=>window.memberSyncHarness.render('a','other'));
 await expect.poll(()=>state(page)).toEqual({actor:'a',state:null});
 await page.evaluate(()=>window.memberSyncHarness.select());
 expect(await page.evaluate(()=>window.memberSyncHarness.calls().length)).toBe(2);
 await page.evaluate(()=>window.memberSyncHarness.unmount());
 expect((await page.evaluate(()=>window.memberSyncHarness.calls()))[1].aborted).toBe(true);
});
