import {afterEach,expect,it,vi} from 'vitest';
import {createLiveGameCommandClient} from '@/lib/live-game-command-client';
vi.mock('@/lib/env',()=>({getSupabaseUrl:()=> 'https://fixture.invalid',getSupabaseAnonKey:()=> 'fixture-public-key'}));
afterEach(()=>vi.unstubAllGlobals());
it('rejects a missing or different actor before creating a command client',()=>{
  expect(()=>createLiveGameCommandClient(undefined,null)).toThrow('Sign-in required');
  expect(()=>createLiveGameCommandClient('a',{user:{id:'b'},access_token:'token-b'})).toThrow('Sign-in required');
  expect(()=>createLiveGameCommandClient('a',{user:{id:'a'},access_token:''})).toThrow('Sign-in required');
});
it('sends the captured JWT with the real SDK even after the session object changes',async()=>{
  const received:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{
    received.push(new Headers(init.headers).get('Authorization')!);
    return new Response('true',{status:200,headers:{'Content-Type':'application/json'}});
  }));
  const session={user:{id:'a'},access_token:'token-a'};
  const command=createLiveGameCommandClient('a',session);
  session.user.id='b';session.access_token='token-b';
  const result=await command.client.rpc('scope_probe',{});
  expect(result.error).toBeNull();expect(received).toEqual(['Bearer token-a']);
});
