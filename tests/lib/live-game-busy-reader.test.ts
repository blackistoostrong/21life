import {createClient} from '@supabase/supabase-js';
import {fetchBusyLiveGameParticipantKeys} from '@/lib/live-game-service';
import {liveGameBusyReaderConformance} from '../shared/live-game-busy-reader-conformance';
liveGameBusyReaderConformance(fetcher=>{
 const client=createClient('https://fixture.invalid','fixture-public-key',{accessToken:async()=>'fixture-token',
  auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetcher}});
 return(keys,options)=>fetchBusyLiveGameParticipantKeys(client,'group',keys,options);
});
