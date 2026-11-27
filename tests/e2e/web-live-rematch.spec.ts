import {test,expect,type Page,type Route} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
declare global{interface Window{rematchHarness:{render:(actor?:string,online?:boolean)=>void;start:()=>void;close:()=>void;hold:()=>void;release:()=>void;
 stats:()=>{writes:number;syncs:number;record:{id:string;state:{players:{displayName:string;commander:string;life:number}[]}}|null};unmount:()=>void;}}}
let bundle:string;
test.beforeAll(async()=>{
 const runtime=createRequire(resolve('package.json')),toolchain=createRequire(resolve('node_modules/vitest/package.json'));
 const {build}=await import(pathToFileURL(toolchain.resolve('vite')).href) as {build:typeof import('vitest/node').Vite.build};
 const ports:Record<string,string>={
  '@/components/language-provider':'export const useLanguage=()=>({copy:label=>label.en});',
  '@/hooks/use-toast':'export const useToast=()=>({toast:()=>{}});',
  'next/navigation':'export const useRouter=()=>({replace:()=>{}});',
  '@/lib/supabase':'export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:"alice"},access_token:"fixture-token"}},error:null})}};',
  'expo-crypto':'export const randomUUID=()=>crypto.randomUUID();',
  '@/lib/live-game-telemetry':'export const recordLiveGameMutationSync=()=>{};export const recordLiveGameSyncError=()=>{};export const recordLiveGameQueueDepth=()=>{};',
  '@react-native-async-storage/async-storage':'export default {getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{},multiSet:async()=>{}};',
 };
 const result=await build({configFile:false,root:resolve('.'),logLevel:'error',define:{'process.env.NODE_ENV':JSON.stringify('development'),'process.env.NEXT_PUBLIC_SUPABASE_URL':'location.origin','process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':JSON.stringify('fixture-public-key')},
  resolve:{alias:[...Object.keys(ports).map(key=>({find:new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`),replacement:'\0rematch:'+key})),
   {find:/^react$/,replacement:runtime.resolve('react')},{find:/^react-dom\/client$/,replacement:runtime.resolve('react-dom/client')},
   {find:/^react-dom$/,replacement:runtime.resolve('react-dom')},{find:'@',replacement:resolve('.')}]},
  plugins:[{name:'rematch-io',enforce:'pre',resolveId:(id,importer)=>{
   if(id.startsWith('\0rematch:'))return id;
   if(id==='./env'&&importer?.endsWith('live-game-command-client.ts'))return '\0rematch-env';
  },load:id=>id==='\0rematch-env'?'export const getSupabaseUrl=()=>location.origin;export const getSupabaseAnonKey=()=>"fixture-public-key";':ports[id.replace('\0rematch:','')]}],
  build:{write:false,minify:false,lib:{entry:resolve('tests/fixtures/web-live-rematch.tsx'),name:'WebRematch',formats:['iife']}}});
 const outputs=Array.isArray(result)?result:[result];if(outputs.length!==1||!('output'in outputs[0]))throw Error('Unexpected bundle');
 bundle=outputs[0].output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n');
});
async function open(page:Page,options:{missing?:boolean;hold?:boolean}={}){
 let release:()=>void=()=>{};let lookups=0;let aborted=0;const pending=new Promise<void>(resolve=>{release=resolve;});
 page.on('requestfailed',request=>{if(new URL(request.url()).pathname.endsWith('/groups'))aborted++;});
 await page.route('**/rest/v1/**',async(route:Route)=>{
  const url=new URL(route.request().url());const table=url.pathname.split('/').at(-1)!;
  let data:unknown=[];
  if(table==='groups'){
   lookups++;if(options.hold)await pending;
   data=[{id:'group',group_members:[{user_id:'alice',profiles:{id:'alice',username:'alice',display_name:'Alice now'}}]}];
  }
  if(table==='decks')data=options.missing?[]:[{id:'deck-a',user_id:'alice',group_id:null,commander:'A now',commander_image:null,is_archived:false,source_type:'manual'}];
  if(table==='arena_guests')data=[{id:'bob',group_id:'group',display_name:'Bob now'}];
  if(table==='arena_guest_decks')data=[{id:'deck-b',guest_id:'bob',group_id:'group',commander:'B now',commander_image:null}];
  await route.fulfill({json:data}).catch(()=>{});
 });
 await page.route('**/__rematch',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/__rematch.js"></script>'}));
 await page.route('**/__rematch.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
 await page.goto('/__rematch');await page.evaluate(()=>window.rematchHarness.render());
 return{release,lookups:()=>lookups,aborted:()=>aborted};
}
test('web rematch commits once and keeps sync alive after its own recap closes',async({page})=>{
 await open(page);await page.evaluate(()=>{window.rematchHarness.hold();window.rematchHarness.start();window.rematchHarness.start();});
 await expect.poll(()=>page.evaluate(()=>window.rematchHarness.stats().writes)).toBe(1);
 await expect(page.getByTestId('rematch-state')).toContainText('"open":false');
 expect((await page.evaluate(()=>window.rematchHarness.stats())).record?.state.players.map(player=>[player.displayName,player.commander,player.life]))
  .toEqual([['Alice now','A now',40],['Bob now','B now',40]]);
 await page.evaluate(()=>window.rematchHarness.release());
 await expect.poll(()=>page.evaluate(()=>window.rematchHarness.stats().syncs)).toBe(1);
});
for(const transition of ['close','account','unmount'] as const)test(`web rematch cancels held reference reads on ${transition}`,async({page})=>{
 const probe=await open(page,{hold:true});try{
  await page.evaluate(()=>window.rematchHarness.start());await expect.poll(probe.lookups).toBe(1);
  await page.evaluate(kind=>{if(kind==='close')window.rematchHarness.close();else if(kind==='account')window.rematchHarness.render('bob');else window.rematchHarness.unmount();},transition);
  await expect.poll(probe.aborted).toBe(1);probe.release();
  expect(await page.evaluate(()=>window.rematchHarness.stats())).toMatchObject({writes:0,syncs:0,record:null});
 }finally{probe.release();}
});
test('web rematch clears only the missing deck and returns to setup',async({page})=>{
 await open(page,{missing:true});await page.evaluate(()=>window.rematchHarness.start());
 await expect(page.getByTestId('rematch-state')).toContainText('"open":false');
 await expect(page.getByTestId('rematch-state')).toContainText('"seats":[{"participantKey":"user:alice","deckId":null},{"participantKey":"guest:bob","deckId":"deck-b"}]');
 expect(await page.evaluate(()=>window.rematchHarness.stats())).toMatchObject({writes:0,syncs:0,record:null});
});
test('web offline rematch starts from its scoped historical metadata without reads',async({page})=>{
 const probe=await open(page);await page.evaluate(()=>{window.rematchHarness.render('alice',false);window.rematchHarness.start();});
 await expect.poll(()=>page.evaluate(()=>window.rematchHarness.stats().syncs)).toBe(1);expect(probe.lookups()).toBe(0);
 expect((await page.evaluate(()=>window.rematchHarness.stats())).record?.state.players[0].commander).toBe('A before');
});
