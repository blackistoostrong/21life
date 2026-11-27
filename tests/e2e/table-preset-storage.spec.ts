import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {TablePresetScope,TablePresetV1} from '../../packages/domain/table-presets';

declare global{interface Window{presetStorageHarness:{
 save:(scope:TablePresetScope,name:string)=>Promise<TablePresetV1[]>;
 many:(scope:TablePresetScope,prefix:string,count:number)=>Promise<string[]>;
 list:(scope:TablePresetScope)=>Promise<TablePresetV1[]>;
 raw:(scope:TablePresetScope)=>string|null;future:(scope:TablePresetScope)=>void;
 hold:(scope:TablePresetScope)=>void;held:()=>boolean;release:()=>void;
 begin:(scope:TablePresetScope)=>void;abort:()=>void;result:()=>Promise<string>|null;
}}}
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={accountId:id(1),groupId:id(2)};
let bundle:string;
test.beforeAll(async()=>{
 const runtime=createRequire(resolve('node_modules/vitest/package.json'));
 const {build}=await import(pathToFileURL(runtime.resolve('vite')).href) as {build:typeof import('vitest/node').Vite.build};
 const result=await build({configFile:false,root:resolve('.'),logLevel:'error',
  build:{write:false,minify:false,lib:{entry:resolve('tests/fixtures/table-preset-storage.ts'),name:'TablePresetStorage',formats:['iife']}}});
 const outputs=Array.isArray(result)?result:[result];
 if(outputs.length!==1||!('output'in outputs[0]))throw Error('Unexpected preset storage bundle');
 bundle=outputs[0].output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n');
});
async function open(page:Page){
 await page.route('**/__table_presets',route=>route.fulfill({contentType:'text/html',body:'<script src="/__table_presets.js"></script>'}));
 await page.route('**/__table_presets.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
 await page.goto('/__table_presets');
}
test('table presets serialize real cross-tab saves without losing updates or exceeding ten',async({page,context})=>{
 const second=await context.newPage();await Promise.all([open(page),open(second)]);
 const results=await Promise.all([page.evaluate(s=>window.presetStorageHarness.many(s,'First',6),scope),
  second.evaluate(s=>window.presetStorageHarness.many(s,'Second',6),scope)]);
 expect(results.flat().filter(value=>value==='saved')).toHaveLength(10);
 expect(results.flat().filter(value=>value==='limit')).toHaveLength(2);
 const stored=await page.evaluate(s=>window.presetStorageHarness.list(s),scope);
 expect(stored).toHaveLength(10);expect(new Set(stored.map(preset=>preset.id)).size).toBe(10);
 await page.reload();expect(await page.evaluate(s=>window.presetStorageHarness.list(s),scope)).toEqual(stored);
});
test('table presets isolate browser accounts and groups',async({page})=>{
 await open(page);const contexts=[scope,{...scope,accountId:id(3)},{...scope,groupId:id(4)}];
 for(let n=0;n<contexts.length;n++)await page.evaluate(({scope,name})=>window.presetStorageHarness.save(scope,name),{scope:contexts[n],name:`Pod ${n}`});
 for(let n=0;n<contexts.length;n++){
  const presets=await page.evaluate(scope=>window.presetStorageHarness.list(scope),contexts[n]);
  expect(presets.map(preset=>preset.name)).toEqual([`Pod ${n}`]);
 }
});
test('table presets preserve future document bytes through the actual browser adapter',async({page})=>{
 await open(page);await page.evaluate(scope=>window.presetStorageHarness.future(scope),scope);
 const before=await page.evaluate(scope=>window.presetStorageHarness.raw(scope),scope);
 const outcome=await page.evaluate(scope=>window.presetStorageHarness.save(scope,'New').then(()=> 'saved',error=>error.kind),scope);
 expect(outcome).toBe('unsupported');expect(await page.evaluate(scope=>window.presetStorageHarness.raw(scope),scope)).toBe(before);
});
test('table presets cancel a queued browser lock without writing or blocking another account',async({page,context})=>{
 const second=await context.newPage();await Promise.all([open(page),open(second)]);
 await page.evaluate(scope=>window.presetStorageHarness.hold(scope),scope);
 await expect.poll(()=>page.evaluate(()=>window.presetStorageHarness.held())).toBe(true);
 try{
  await second.evaluate(scope=>window.presetStorageHarness.begin(scope),scope);
  await expect.poll(()=>second.evaluate(async scope=>{
   const locks=await navigator.locks.query();
   return (locks.pending??[]).some(lock=>lock.name===`phyrexian-arena:table-presets:v1:${scope.accountId}:${scope.groupId}`);
  },scope)).toBe(true);
  await second.evaluate(()=>window.presetStorageHarness.abort());
  expect(await second.evaluate(()=>window.presetStorageHarness.result())).toBe('cancelled');
  const other={...scope,accountId:id(9)};
  expect(await second.evaluate(scope=>window.presetStorageHarness.save(scope,'Other'),other)).toHaveLength(1);
  expect(await second.evaluate(scope=>window.presetStorageHarness.raw(scope),scope)).toBeNull();
 }finally{await page.evaluate(()=>window.presetStorageHarness.release());}
 await expect.poll(()=>page.evaluate(()=>window.presetStorageHarness.held())).toBe(false);
 expect(await second.evaluate(scope=>window.presetStorageHarness.list(scope),scope)).toEqual([]);
});
