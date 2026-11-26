import {expect,it} from 'vitest';
import {createLiveGamePlayer} from '@/lib/live-game';
import {claimLiveGameRuntimePresentation,useLiveGameRuntimeStore} from '@/stores/live-game-runtime-store';

const player=(life:number)=>createLiveGamePlayer({slot:0,participantKey:'user:a',deckId:'deck',displayName:'A',
  commander:'A',commanderImage:null,startingLife:life,allParticipantKeys:['user:a']});
it('does not let a hidden or disposed presentation overwrite or clear the focused table',()=>{
  const old=claimLiveGameRuntimePresentation();old.replace([player(40)]);
  const current=claimLiveGameRuntimePresentation();current.replace([player(17)]);
  old.replace([player(99)]);old.release();
  expect(useLiveGameRuntimeStore.getState().playersByKey['user:a']?.life).toBe(17);
  current.release();expect(useLiveGameRuntimeStore.getState().playersByKey).toEqual({});
});
it('lets a screen acquire a fresh presentation when it regains focus',()=>{
  const old=claimLiveGameRuntimePresentation();old.replace([player(40)]);old.release();
  const other=claimLiveGameRuntimePresentation();other.replace([player(12)]);other.release();
  const resumed=claimLiveGameRuntimePresentation();resumed.replace([player(39)]);
  old.release();expect(useLiveGameRuntimeStore.getState().playersByKey['user:a']?.life).toBe(39);resumed.release();
});
