import {test,expect} from '@playwright/test';
import {configureTracker} from './live-tracker-fixture';

test('live game realtime subscribes when a locally started round is acknowledged',async({page})=>{
  test.skip(!process.env.E2E_ACCESS_TOKEN,'Requires disposable Dev authentication.');
  const groupId=process.env.E2E_GROUP_ID!;
  const joined=new Set<string>();const acknowledged=new Set<string>();let catalogReady=false;
  const decode=(payload:string|Buffer)=>{
    try{
      const value=JSON.parse(typeof payload==='string'?payload:payload.toString('utf8'));
      return Array.isArray(value)?{topic:value[2],event:value[3],payload:value[4]}:value;
    }catch{return null;}
  };
  page.on('websocket',socket=>{
    socket.on('framesent',frame=>{
      const message=decode(frame.payload);
      if(message?.event!=='phx_join')return;
      for(const change of message.payload?.config?.postgres_changes??[]){
        if(change.table==='live_games')joined.add(change.filter);
      }
    });
    socket.on('framereceived',frame=>{
      const message=decode(frame.payload);
      if(message?.event!=='phx_reply'||message.payload?.status!=='ok')return;
      if(String(message.topic).includes(groupId))catalogReady=true;
      if(String(message.topic).includes('web-live-game:'))acknowledged.add(message.topic);
    });
  });
  // Observe only channel/filter metadata. Never retain or log join payloads/JWTs.
  await configureTracker(page);
  await expect.poll(()=>catalogReady).toBe(true);
  await page.evaluate(()=>localStorage.setItem('live-onboarding-v1','done'));
  await page.getByTestId('live-start').click();
  await expect(page.getByTestId('live-end')).toBeVisible();
  await expect(page.getByTestId('live-sync-indicator')).toHaveAccessibleName(/Synced|Sincronizzato/,{timeout:15000});
  const gameId=await page.evaluate(({group,user})=>{
    const raw=localStorage.getItem(`phyrexian-arena:web-live-game:v2:${user}:${group}`);
    return raw?JSON.parse(raw).journal.record.id:null;
  },{group:groupId,user:process.env.E2E_USER_ID!});
  expect(gameId).toBeTruthy();
  await expect.poll(()=>joined.has(`id=eq.${gameId}`)).toBe(true);
  await expect.poll(()=>acknowledged.has(`realtime:web-live-game:${gameId}`)).toBe(true);
});
