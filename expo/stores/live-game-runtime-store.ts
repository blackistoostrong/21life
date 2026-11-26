import { create } from 'zustand';
import type { LiveGamePlayer } from '@/lib/live-game';
import type { ParticipantKey } from '@/lib/participant-keys';

type LiveGameRuntimeState = {
  playersByKey: Partial<Record<ParticipantKey, LiveGamePlayer>>;
};

export const useLiveGameRuntimeStore = create<LiveGameRuntimeState>(() => ({
  playersByKey: {},
}));

export function replaceLiveGameRuntimePlayers(players: LiveGamePlayer[]) {
  useLiveGameRuntimeStore.setState({
    playersByKey: Object.fromEntries(
      players.map((player) => [player.participantKey, player]),
    ),
  });
}

export function clearLiveGameRuntimePlayers() {
  useLiveGameRuntimeStore.setState({ playersByKey: {} });
}

let currentPresentation:object|null=null;
/** Only the focused screen may project its players into the shared card renderer. */
export function claimLiveGameRuntimePresentation(){
  const token={};currentPresentation=token;
  return {
    replace(players:LiveGamePlayer[]){if(currentPresentation===token)replaceLiveGameRuntimePlayers(players);},
    release(){if(currentPresentation===token){currentPresentation=null;clearLiveGameRuntimePlayers();}},
  };
}
