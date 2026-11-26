import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

declare global{interface Window{webJournalHarness:{
  render:(actor?:string,group?:string)=>void;capture:()=>number;start:(actor?:string,group?:string)=>void;
  restore:()=>void;lateFinish:(index:number)=>boolean;lateEnqueue:(index:number)=>boolean;
  adjust:()=>boolean;undo:()=>boolean;redo:()=>boolean;unmount:()=>void;
}}}
let bundle:string;
test.beforeAll(async()=>{
  const runtime=createRequire(resolve('package.json'));
  const toolchain=createRequire(resolve('node_modules/vitest/package.json'));
  const {build}=await import(pathToFileURL(toolchain.resolve('vite')).href) as {build:typeof import('vitest/node').Vite.build};
  const result=await build({configFile:false,root:resolve('.'),logLevel:'error',
    define:{'process.env.NODE_ENV':JSON.stringify('development')},
    resolve:{alias:[{find:/^react$/,replacement:runtime.resolve('react')},
      {find:/^react-dom\/client$/,replacement:runtime.resolve('react-dom/client')},
      {find:/^react-dom$/,replacement:runtime.resolve('react-dom')},{find:'@',replacement:resolve('.')}]},
    build:{write:false,minify:false,lib:{entry:resolve('tests/e2e/fixtures/web-live-journal.tsx'),name:'WebLiveJournal',formats:['iife']}}});
  const outputs=Array.isArray(result)?result:[result];
  if(outputs.length!==1||!('output'in outputs[0]))throw Error('Unexpected journal bundle');
  bundle=outputs[0].output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n');
});
async function open(page:Page){
  await page.route('**/__web_journal',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/__web_journal.js"></script>'}));
  await page.route('**/__web_journal.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
  await page.goto('/__web_journal');await page.evaluate(()=>window.webJournalHarness.render());
  await expect(page.getByTestId('journal-view')).toHaveText('alice:g1:empty:-');
}
test('web journal masks old snapshots across A to B to A and rejects old opening acknowledgements',async({page})=>{
  await open(page);await page.evaluate(()=>window.webJournalHarness.start());
  await expect(page.getByTestId('journal-view')).toHaveText('alice:g1:game-alice-g1:40');
  const old=await page.evaluate(()=>window.webJournalHarness.capture());
  await page.evaluate(()=>window.webJournalHarness.render('bob'));
  await expect(page.getByTestId('journal-view')).toHaveText('bob:g1:empty:-');
  expect(await page.evaluate(index=>window.webJournalHarness.lateFinish(index),old)).toBe(false);
  await page.evaluate(()=>window.webJournalHarness.render());
  await expect(page.getByTestId('journal-view')).toHaveText('alice:g1:empty:-');
  await page.evaluate(()=>window.webJournalHarness.restore());
  await expect(page.getByTestId('journal-view')).toHaveText('alice:g1:game-alice-g1:40');
  expect(await page.evaluate(index=>window.webJournalHarness.lateEnqueue(index),old)).toBe(false);
});
test('web journal changes group and survives a StrictMode unmount without retaining the old writer',async({page})=>{
  await open(page);await page.evaluate(()=>window.webJournalHarness.start());
  const old=await page.evaluate(()=>window.webJournalHarness.capture());
  await page.evaluate(()=>window.webJournalHarness.render('alice','g2'));
  await expect(page.getByTestId('journal-view')).toHaveText('alice:g2:empty:-');
  await page.evaluate(()=>window.webJournalHarness.unmount());
  expect(await page.evaluate(index=>window.webJournalHarness.lateFinish(index),old)).toBe(false);
  await page.evaluate(()=>window.webJournalHarness.render());
  await expect(page.getByTestId('journal-view')).toHaveText('alice:g1:empty:-');
  await page.evaluate(()=>window.webJournalHarness.restore());
  await expect(page.getByTestId('journal-view')).toHaveText('alice:g1:game-alice-g1:40');
});
test('web journal renders mutations undo and redo from its sole snapshot owner',async({page})=>{
  await open(page);await page.evaluate(()=>window.webJournalHarness.start());
  await page.evaluate(()=>window.webJournalHarness.adjust());
  await expect(page.getByTestId('journal-view')).toHaveText('alice:g1:game-alice-g1:39');
  await page.evaluate(()=>window.webJournalHarness.undo());
  await expect(page.getByTestId('journal-view')).toHaveText('alice:g1:game-alice-g1:40');
  await page.evaluate(()=>window.webJournalHarness.redo());
  await expect(page.getByTestId('journal-view')).toHaveText('alice:g1:game-alice-g1:39');
});
