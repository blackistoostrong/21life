import {useEffect,useState,type Dispatch,type SetStateAction,type MutableRefObject} from 'react';
import NetInfo from '@react-native-community/netinfo';
import {AppState} from 'react-native';
import type {LiveGameRecord} from '@/lib/live-game';
import {applyLiveGameImmersive} from '@/lib/live-game-immersive';
import {persistLiveGameTelemetry} from '@/lib/live-game-telemetry';
import {supabase} from '@/lib/supabase';
type Ports={currentUserId:string|undefined;isLiveScopeCurrent:()=>boolean;syncJournal:()=>Promise<void>;
 resumeRemoteGame:()=>Promise<void>;refreshAuthoritativeState:()=>Promise<void>;setSetupRetry:Dispatch<SetStateAction<number>>;
 setSyncStatus:Dispatch<SetStateAction<'offline'|'pending'|'syncing'|'synced'|'error'>>;
 syncTimerRef:MutableRefObject<ReturnType<typeof setTimeout>|null>;liveGameRef:MutableRefObject<LiveGameRecord|null>;
 telemetrySessionRef:MutableRefObject<string>};
/** Owns native connectivity, foreground events and their scheduled work. */
export function useNativeLiveConnectivity({currentUserId,isLiveScopeCurrent,syncJournal,resumeRemoteGame,
 refreshAuthoritativeState,setSetupRetry,setSyncStatus,syncTimerRef,liveGameRef,telemetrySessionRef}:Ports){
const [networkOnline, setNetworkOnline] = useState(true);
useEffect(() => {
    return NetInfo.addEventListener((state) => {
      if (!isLiveScopeCurrent()) return;
      const online = state.isConnected === true && state.isInternetReachable !== false;
      setNetworkOnline(online);
      if (!online) {
        if (syncTimerRef.current) {
          clearTimeout(syncTimerRef.current);
          syncTimerRef.current = null;
        }
        setSyncStatus('offline');
        return;
      }
      void syncJournal();
    });
  }, [isLiveScopeCurrent, syncJournal]);
useEffect(() => {
    const interval = setInterval(() => {
      void NetInfo.fetch().then((state) => {
        if (state.isConnected === true && state.isInternetReachable !== false) {
          void syncJournal();
          void resumeRemoteGame().catch(() => undefined);
          setSetupRetry(current => current + 1);
        }
      });
    }, 10_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void resumeRemoteGame().catch(() => undefined);
        void refreshAuthoritativeState().catch(() => undefined).finally(() => syncJournal());
        if (liveGameRef.current) applyLiveGameImmersive();
      } else if (currentUserId) {
        void persistLiveGameTelemetry(supabase, {
          userId: currentUserId,
          liveGameId: liveGameRef.current?.id ?? null,
          sessionId: telemetrySessionRef.current,
          platform: 'expo',
          force: true,
        }).catch(() => undefined);
      }
    });
    return () => {
      clearInterval(interval);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      appStateSubscription.remove();
    };
  }, [currentUserId, refreshAuthoritativeState, resumeRemoteGame, setSetupRetry, syncJournal]);
return {networkOnline};
}
