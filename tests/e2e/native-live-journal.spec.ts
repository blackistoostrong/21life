import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

declare global{interface Window{nativeJournalHarness:{
 render:(actor?:string,group?:string,token?:string,pair?:boolean)=>void;start:(slot?:string,life?:number)=>Promise<void>;
 adjust:(slot?:string,amount?:number)=>Promise<void>;capture:(slot?:string)=>number;same:(index:number,slot?:string)=>boolean;
 lateClose:(index:number)=>Promise<boolean>;focus:(slot:'a'|'b',value:boolean)=>void;listeners:(slot:'a'|'b')=>number;unmount:()=>void;
 restore:(slot?:string)=>Promise<void>;
}}}
let bundle:string;
test.beforeAll(async()=>{
 const runtime=createRequire(resolve('expo/package.json'));
 const toolchain=createRequire(resolve('node_modules/vitest/package.json'));
 const {build}=await import(pathToFileURL(toolchain.resolve('vite')).href) as {build:typeof import('vitest/node').Vite.build};
 const ports=resolve('expo/tests/fixtures/native-live-journal-ports.tsx').replaceAll('\\','/');
 const focus=resolve('expo/node_modules/expo-router/build/useFocusEffect.js').replaceAll('\\','/');
 const result=await build({configFile:false,root:resolve('expo'),logLevel:'error',define:{'process.env.NODE_ENV':JSON.stringify('development')},
  resolve:{alias:[{find:/^react$/,replacement:runtime.resolve('react')},{find:/^react-dom\/client$/,replacement:runtime.resolve('react-dom/client')},
   {find:/^react-dom$/,replacement:runtime.resolve('react-dom')},{find:'@',replacement:resolve('expo')}]},
  plugins:[{name:'native-journal-platform-ports',enforce:'pre',
   resolveId:(id,importer)=>{
    if(id==='expo-router')return '\0journal-router';
    if(id==='expo-crypto')return '\0journal-crypto';
    if(id==='@react-native-async-storage/async-storage')return '\0journal-storage';
    if(importer?.replaceAll('\\','/').includes('expo-router/build/useFocusEffect.js')&&['./useNavigation','./link/useLoadedNavigation'].includes(id))return '\0journal-navigation';
    if(id==='./env'&&importer?.endsWith('live-game-command-client.ts'))return '\0journal-env';
   },
   load:id=>{
    if(id==='\0journal-router')return `export {useFocusEffect} from ${JSON.stringify(focus)};`;
    if(id==='\0journal-navigation')return `export {useNavigation,useOptionalNavigation} from ${JSON.stringify(ports)};`;
    if(id==='\0journal-storage')return `export {storage as default} from ${JSON.stringify(ports)};`;
    if(id==='\0journal-crypto')return 'export const randomUUID=()=>crypto.randomUUID();';
    if(id==='\0journal-env')return 'export const getSupabaseUrl=()=>location.origin;export const getSupabaseAnonKey=()=>"fixture-public-key";';
   }}],
  build:{write:false,minify:false,lib:{entry:resolve('expo/tests/fixtures/native-live-journal.tsx'),name:'NativeJournal',formats:['iife']}}});
 const outputs=Array.isArray(result)?result:[result];
 if(outputs.length!==1||!('output'in outputs[0]))throw Error('Unexpected journal fixture bundle');
 bundle=outputs[0].output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n');
});
async function open(page:Page,pair=false){
 await page.route('**/__native_journal',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/__native_journal.js"></script>'}));
 await page.route('**/__native_journal.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
 await page.goto('/__native_journal');await page.evaluate(pair=>window.nativeJournalHarness.render('alice','g1','token-a',pair),pair);
 await expect(page.getByTestId('native-journal-a')).toHaveText('alice:g1:empty:-:token-a');
 await expect.poll(()=>page.evaluate(()=>window.nativeJournalHarness.listeners('a'))).toBe(2);
}
test('native journal keeps hidden table writes out of the focused player projection',async({page})=>{
 await open(page,true);await page.evaluate(()=>window.nativeJournalHarness.start('a',40));
 await page.evaluate(()=>window.nativeJournalHarness.start('b',17));
 await expect(page.getByTestId('native-journal-projection')).toContainText('user:alice:40');
 await page.evaluate(()=>window.nativeJournalHarness.focus('b',true));
 await page.evaluate(()=>window.nativeJournalHarness.adjust('a',5));
 await expect(page.getByTestId('native-journal-projection')).toContainText('user:alice:17');
 await page.evaluate(()=>window.nativeJournalHarness.focus('a',false));
 await expect(page.getByTestId('native-journal-projection')).toContainText('user:alice:17');
 await page.evaluate(()=>{window.nativeJournalHarness.focus('b',false);window.nativeJournalHarness.focus('a',true);});
 await expect(page.getByTestId('native-journal-projection')).toContainText('user:alice:35');
});
test('native journal changes account and group through A to B to A without accepting an old opening close',async({page})=>{
 await open(page);await page.evaluate(()=>window.nativeJournalHarness.start());
 const old=await page.evaluate(()=>window.nativeJournalHarness.capture());
 await page.evaluate(()=>window.nativeJournalHarness.render('bob','g2','token-b'));
 await expect(page.getByTestId('native-journal-a')).toHaveText('bob:g2:empty:-:token-b');
 await expect(page.getByTestId('native-journal-projection')).toBeEmpty();
 expect(await page.evaluate(index=>window.nativeJournalHarness.lateClose(index),old)).toBe(false);
 await page.evaluate(()=>window.nativeJournalHarness.start('a',30));
 await expect(page.getByTestId('native-journal-projection')).toContainText('user:bob:30');
 await page.evaluate(()=>window.nativeJournalHarness.render());
 await expect(page.getByTestId('native-journal-a')).toHaveText('alice:g1:empty:-:token-a');
 await page.evaluate(()=>window.nativeJournalHarness.restore());
 await expect(page.getByTestId('native-journal-a')).toHaveText('alice:g1:game-a-g1:40:token-a');
 expect(await page.evaluate(index=>window.nativeJournalHarness.lateClose(index),old)).toBe(false);
});
test('native journal preserves its owner and listener count during JWT renewal',async({page})=>{
 await open(page);await page.evaluate(()=>window.nativeJournalHarness.start());
 const old=await page.evaluate(()=>window.nativeJournalHarness.capture());
 await page.evaluate(()=>window.nativeJournalHarness.render('alice','g1','renewed'));
 await expect(page.getByTestId('native-journal-a')).toHaveText('alice:g1:game-a-g1:40:renewed');
 expect(await page.evaluate(index=>window.nativeJournalHarness.same(index),old)).toBe(true);
 expect(await page.evaluate(()=>window.nativeJournalHarness.listeners('a'))).toBe(2);
 await page.evaluate(()=>window.nativeJournalHarness.adjust());
 await expect(page.getByTestId('native-journal-projection')).toContainText('user:alice:39');
 await page.evaluate(()=>window.nativeJournalHarness.unmount());
 expect(await page.evaluate(()=>window.nativeJournalHarness.listeners('a'))).toBe(0);
 await expect(page.getByTestId('native-journal-projection')).toHaveCount(0);
});
