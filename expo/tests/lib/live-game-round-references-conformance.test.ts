import {createClient} from '@supabase/supabase-js';
import {createLiveGameReferenceReader} from '@/lib/live-game-reference-reader';
import {liveGameReferenceReaderConformance} from '../../../tests/shared/live-game-reference-reader-conformance';

liveGameReferenceReaderConformance(fetcher=>createLiveGameReferenceReader(createClient('https://fixture.invalid','fixture-public-key',{
  accessToken:async()=>'fixture-token',auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetcher},
})));
