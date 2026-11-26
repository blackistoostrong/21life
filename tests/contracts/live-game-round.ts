import {expect,it} from 'vitest';
import type {createLiveGameRound as Factory} from '../../packages/domain/live-game-round';
import {createLiveGamePlayer} from '../../packages/domain/live-game-players';
import type {ParticipantKey} from '../../packages/domain/participant-keys';

export function registerRoundContract(createRound: typeof Factory) {
  for(const count of [2,4,6])it(`rematch resets a dirty ${count}-seat pod, preserving user/guest seats and decks`,()=>{
    const keys=Array.from({length:count},(_,index)=>`${index%2?'guest':'user'}:${index}` as ParticipantKey);
    const previous=keys.map((participantKey,slot)=>({...createLiveGamePlayer({slot,participantKey,
      deckId:`deck-${slot}`,displayName:`Player ${slot}`,commander:`Commander ${slot}`,commanderImage:null,
      startingLife:40,allParticipantKeys:keys}),life:-10,infect:12,isEliminated:true,eliminatedAt:'old',
      counters:{energy:4,experience:3,commanderTax:6,monarch:true,initiative:true},
      commanderDamageFrom:Object.fromEntries(keys.filter(key=>key!==participantKey).map(key=>[key,25])) as Record<ParticipantKey,number>}));
    const before=JSON.stringify(previous);
    const round=createRound({id:'new-round',groupId:'group',actorId:'owner',startedAt:'2026-11-25T12:00:00Z',
      startingLife:25,layoutVariant:'opposed',seats:previous,random:()=>0.999});
    expect(JSON.stringify(previous)).toBe(before);
    expect(round).toMatchObject({id:'new-round',status:'active',starting_life:25,match_id:null,ended_at:null,
      state:{version:0,events:[],startingPlayerKey:keys.at(-1),startingDirection:'counterclockwise',layoutVariant:'opposed'}});
    expect(round.state.summary).toMatchObject({totalEvents:0,byParticipant:{}});
    expect(round.state.players.map(player=>player.participantKey)).toEqual(keys);
    round.state.players.forEach((player,slot)=>{
      expect(player).toMatchObject({slot,deckId:`deck-${slot}`,displayName:`Player ${slot}`,commander:`Commander ${slot}`,
        life:25,infect:0,isEliminated:false,eliminatedAt:null,
        counters:{energy:0,experience:0,commanderTax:0,monarch:false,initiative:false}});
      expect(Object.keys(player.commanderDamageFrom)).toEqual(keys.filter(key=>key!==player.participantKey));
      expect(Object.values(player.commanderDamageFrom).every(value=>value===0)).toBe(true);
    });
  });
  it('keeps rounds independent and handles empty projections with injected clock/identity/random',()=>{
    const input={id:'one',groupId:'group',actorId:'owner',startedAt:'2026-11-25T12:00:00Z',startingLife:40,
      layoutVariant:'classic' as const,seats:[],random:()=>0};
    const first=createRound(input),second=createRound({...input,id:'two'});
    expect(first.state.startingPlayerKey).toBeNull();expect(first.state.startingDirection).toBe('clockwise');
    expect(first.started_at).toBe(input.startedAt);expect(first.created_at).toBe(first.updated_at);
    expect(second.id).not.toBe(first.id);
    expect(first.state.players).not.toBe(second.state.players);
    expect(first.state.summary).not.toBe(second.state.summary);
    expect(first.state.events).not.toBe(second.state.events);
  });
}
