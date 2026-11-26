import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createWebLiveCommandClient} from '@/lib/web-live-command-client';

const {sessionRead}=vi.hoisted(()=>({sessionRead:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:sessionRead}}}));
beforeEach(()=>{
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.invalid');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','public-fixture-key');
  sessionRead.mockResolvedValue({data:{session:{user:{id:'a'},access_token:'token-a'}},error:null});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();vi.clearAllMocks();});

it('rejects a replacement actor before issuing any private request',async()=>{
  sessionRead.mockResolvedValue({data:{session:{user:{id:'b'},access_token:'token-b'}},error:null});
  const network=vi.fn();vi.stubGlobal('fetch',network);
  await expect(createWebLiveCommandClient('a',new AbortController().signal)).rejects.toThrow('Sign-in required');
  expect(network).not.toHaveBeenCalled();
});

it('keeps the captured JWT with the real SDK after the session changes',async()=>{
  const session={user:{id:'a'},access_token:'token-a'};
  sessionRead.mockResolvedValue({data:{session},error:null});
  const headers:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(request:Request)=>{
    headers.push(request.headers.get('Authorization')!);
    return new Response('true',{headers:{'Content-Type':'application/json'}});
  }));
  const {client}=await createWebLiveCommandClient('a',new AbortController().signal);
  session.user.id='b';session.access_token='token-b';
  const result=await client.rpc('scope_probe',{});
  expect(result.error).toBeNull();expect(headers).toEqual(['Bearer token-a']);
});

it('bounds a response body that stalls after successful headers',async()=>{
  vi.useFakeTimers();
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(){}}),{headers:{'Content-Type':'application/json'}})));
  const {client}=await createWebLiveCommandClient('a',new AbortController().signal);
  const outcome=Promise.resolve(client.rpc('scope_probe',{}));
  await vi.advanceTimersByTimeAsync(15001);
  expect((await outcome).error).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a pending SDK operation when its private owner ends',async()=>{
  const parent=new AbortController();let started!:()=>void;
  const pending=new Promise<void>(resolve=>{started=resolve;});
  vi.stubGlobal('fetch',vi.fn((request:Request)=>new Promise<Response>((_resolve,reject)=>{
    request.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
    started();
  })));
  const {client}=await createWebLiveCommandClient('a',parent.signal);
  const outcome=Promise.resolve(client.rpc('scope_probe',{}));
  await pending;parent.abort();
  expect((await outcome).error).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});
