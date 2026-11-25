import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
type Harness={render:(actor?:string,group?:string,token?:string)=>void;capture:()=>number;active:(index:number)=>boolean;
  sameEpoch:(index:number)=>boolean;send:(index:number)=>Promise<void>;unmount:()=>void};
declare global{interface Window{liveScopeHarness:Harness}}
let bundle:string;
test.beforeAll(async()=>{
  const runtime=createRequire(resolve('expo/package.json'));
  const toolchain=createRequire(resolve('node_modules/vitest/package.json'));
  const {build}=await import(pathToFileURL(toolchain.resolve('vite')).href) as {build:typeof import('vitest/node').Vite.build};
  const result=await build({configFile:false,root:resolve('expo'),logLevel:'error',
    define:{'process.env.NODE_ENV':JSON.stringify('production')},
    resolve:{alias:[{find:'@/lib/env',replacement:'\0scope-env'},
      {find:/^react$/,replacement:runtime.resolve('react')},
      {find:/^react-dom\/client$/,replacement:runtime.resolve('react-dom/client')},
      {find:/^react-dom$/,replacement:runtime.resolve('react-dom')},
      {find:'@',replacement:resolve('expo')}]},
    plugins:[{name:'scope-env',enforce:'pre',resolveId:(id,importer)=>id==='\0scope-env'||
      (id==='./env'&&importer?.endsWith('live-game-command-client.ts'))?'\0scope-env':undefined,
      load:id=>id==='\0scope-env'?'export const getSupabaseUrl=()=>location.origin;export const getSupabaseAnonKey=()=>"fixture-public-key";':undefined}],
    build:{write:false,minify:false,lib:{entry:resolve('tests/e2e/fixtures/native-live-scope.tsx'),name:'NativeLiveScope',formats:['iife']}}});
  const outputs=Array.isArray(result)?result:[result];
  if(outputs.length!==1||!('output'in outputs[0]))throw Error('Unexpected scope bundle');
  bundle=outputs[0].output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n');
});
async function open(page:Page){
  await page.route('**/__live_scope',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/__live_scope.js"></script>'}));
  await page.route('**/__live_scope.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
  await page.goto('/__live_scope');await page.evaluate(()=>window.liveScopeHarness.render());
  await expect(page.getByTestId('scope-owner')).toHaveText('a:g1:token-a');
}
test('native live scope discards old account openings including A to B to A',async({page})=>{
  await open(page);const old=await page.evaluate(()=>window.liveScopeHarness.capture());
  await page.evaluate(()=>window.liveScopeHarness.render('b','g1','token-b'));
  await expect(page.getByTestId('scope-owner')).toHaveText('b:g1:token-b');
  expect(await page.evaluate(index=>window.liveScopeHarness.active(index),old)).toBe(false);
  await page.evaluate(()=>window.liveScopeHarness.render());
  await expect(page.getByTestId('scope-owner')).toHaveText('a:g1:token-a');
  expect(await page.evaluate(index=>window.liveScopeHarness.active(index),old)).toBe(false);
});
test('native live scope renews tokens without resetting ownership and freezes each SDK command identity',async({page})=>{
  await open(page);const auth:string[]=[];
  await page.route('**/rest/v1/rpc/scope_probe',route=>{auth.push(route.request().headers().authorization);return route.fulfill({json:true});});
  const first=await page.evaluate(()=>window.liveScopeHarness.capture());
  await page.evaluate(()=>window.liveScopeHarness.render('a','g1','token-a-renewed'));
  await expect(page.getByTestId('scope-owner')).toHaveText('a:g1:token-a-renewed');
  expect(await page.evaluate(index=>window.liveScopeHarness.sameEpoch(index),first)).toBe(true);
  await page.evaluate(async index=>{const next=window.liveScopeHarness.capture();await window.liveScopeHarness.send(index);await window.liveScopeHarness.send(next);},first);
  expect(auth).toEqual(['Bearer token-a','Bearer token-a-renewed']);
});
test('native live scope cancels on group change and unmount without resurrecting an old opening',async({page})=>{
  await open(page);const old=await page.evaluate(()=>window.liveScopeHarness.capture());
  await page.evaluate(()=>window.liveScopeHarness.render('a','g2','token-a'));
  await expect(page.getByTestId('scope-owner')).toHaveText('a:g2:token-a');
  expect(await page.evaluate(index=>window.liveScopeHarness.active(index),old)).toBe(false);
  const current=await page.evaluate(()=>window.liveScopeHarness.capture());
  await page.evaluate(()=>window.liveScopeHarness.unmount());
  expect(await page.evaluate(index=>window.liveScopeHarness.active(index),current)).toBe(false);
  await page.evaluate(()=>window.liveScopeHarness.render('a','g2','token-a'));
  await expect(page.getByTestId('scope-owner')).toHaveText('a:g2:token-a');
  expect(await page.evaluate(index=>window.liveScopeHarness.active(index),current)).toBe(false);
});
