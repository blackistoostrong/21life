import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session, User } from '@supabase/supabase-js';
import { changeProfilePassword } from '@/lib/profile-password';

const user: User = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated',
  email: 'password-fixture@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function fixture() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = (sessionId: string) => `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp, session_id: sessionId })}.${encode('signature')}`;
  const session: Session = { access_token: jwt('main'), refresh_token: 'main-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp, user };
  const verification = { ...session, access_token: jwt('verification'), refresh_token: 'verification-refresh' };
  return { session, verification, userId: user.id, email: user.email!, currentPassword: 'Current123', newPassword: 'NextPassword123' };
}

describe('password Auth isolation using the real SDK', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  function prepare() {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://password-test.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fixture-anon-key');
    const input = fixture();
    const calls: string[] = [];
    const fetcher = vi.fn(async (target: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
      const path = new URL(typeof target === 'string' ? target : target instanceof URL ? target.href : target.url).pathname;
      const method = options?.method ?? 'GET';
      calls.push(method + ' ' + path);
      const auth = new Headers(options?.headers).get('authorization');
      if (path.endsWith('/token')) return json(input.verification);
      if (path.endsWith('/logout')) {
        expect(auth === `Bearer ${input.verification.access_token}`).toBe(true);
        return new Response(null, { status: 204 });
      }
      if (path.endsWith('/user')) {
        expect(auth === `Bearer ${input.session.access_token}`).toBe(true);
        if (method === 'PUT') {
          const body = JSON.parse(String(options?.body));
          expect(body.password === input.newPassword && body.current_password === input.currentPassword).toBe(true);
        }
        return json(user);
      }
      throw new Error('Unexpected Auth endpoint');
    });
    vi.stubGlobal('fetch', fetcher);
    return { input, calls, fetcher };
  }

  it('verifies in memory, restores the original JWT, updates it, and revokes only verification', async () => {
    const { input, calls } = prepare();
    const before = JSON.stringify(input.session);
    await (await changeProfilePassword(input)).cleanup;
    expect(calls).toEqual(['POST /auth/v1/token', 'GET /auth/v1/user', 'PUT /auth/v1/user', 'POST /auth/v1/logout']);
    expect(JSON.stringify(input.session) === before).toBe(true);
  });

  it('rejects a wrong current password without updating or restoring any session', async () => {
    const { input, fetcher } = prepare();
    fetcher.mockImplementation(async () => json({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400));
    await expect(changeProfilePassword(input)).rejects.toMatchObject({ code: 'current-password' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects verification for another account and cleans up only that temporary login', async () => {
    const { input, fetcher, calls } = prepare();
    fetcher.mockResolvedValueOnce(json({ ...input.verification, user: { ...user, id: 'another-user' } }));
    await expect(changeProfilePassword(input)).rejects.toMatchObject({ code: 'session-unavailable' });
    expect(calls).toEqual(['POST /auth/v1/logout']);
  });

  it.each(['GET', 'PUT'])('preserves a %s user API error and revokes temporary verification', async method => {
    const { input, fetcher, calls } = prepare();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((target, options) => String(target).endsWith('/user') && (options?.method ?? 'GET') === method
      ? Promise.resolve(json({ msg: 'Synthetic account failure' }, 422)) : original(target, options));
    await expect(changeProfilePassword(input)).rejects.toThrow('Synthetic account failure');
    await vi.waitFor(() => expect(calls).toContain('POST /auth/v1/logout'));
    if (method === 'GET') expect(calls).not.toContain('PUT /auth/v1/user');
  });

  it('rejects an original JWT belonging to another user before any password write', async () => {
    const { input, fetcher, calls } = prepare();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((target, options) => String(target).endsWith('/user') && (options?.method ?? 'GET') === 'GET'
      ? Promise.resolve(json({ ...user, id: 'another-user' })) : original(target, options));
    await expect(changeProfilePassword(input)).rejects.toMatchObject({ code: 'session-unavailable' });
    await vi.waitFor(() => expect(calls).toContain('POST /auth/v1/logout'));
    expect(calls).not.toContain('PUT /auth/v1/user');
  });

  it('never logs out the original token if verification returns that same token', async () => {
    const { input, fetcher, calls } = prepare();
    fetcher.mockResolvedValueOnce(json({ ...input.verification, access_token: input.session.access_token }));
    await (await changeProfilePassword(input)).cleanup;
    expect(calls).toEqual(['GET /auth/v1/user', 'PUT /auth/v1/user']);
  });

  it('aborts during restore and prevents a late SDK response from sending an update', async () => {
    const { input, fetcher, calls } = prepare();
    let started!: () => void; let finish!: (response: Response) => void;
    const restoring = new Promise<void>(resolve => { started = resolve; });
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (target, options) => {
      if (String(target).endsWith('/user') && (!options?.method || options.method === 'GET')) {
        started(); return new Promise<Response>(resolve => { finish = resolve; });
      }
      return original(target, options);
    });
    const controller = new AbortController();
    const pending = changeProfilePassword({ ...input, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await restoring; controller.abort(); await rejected;
    finish(json(user));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toEqual(['POST /auth/v1/token', 'POST /auth/v1/logout']);
  });

  it('does not report an accepted password change as failed when cleanup fails', async () => {
    const { input, fetcher } = prepare();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((target, options) => String(target).includes('/logout')
      ? Promise.resolve(json({ msg: 'Synthetic cleanup failure' }, 500)) : original(target, options));
    await (await changeProfilePassword(input)).cleanup;
    expect(warning).toHaveBeenCalledWith('Temporary password verification cleanup was not acknowledged', expect.objectContaining({ status: 500 }));
  });

  it('recognizes verification already revoked by the password update without a false warning', async () => {
    const { input, fetcher } = prepare();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((target, options) => String(target).includes('/logout')
      ? Promise.resolve(json({ error_code: 'session_not_found', msg: 'Session missing' }, 400)) : original(target, options));
    await (await changeProfilePassword(input)).cleanup;
    expect(warning).not.toHaveBeenCalled();
  });

  it('rejects unavailable/expiring sessions and pre-aborted work without Auth requests', async () => {
    const { input, fetcher } = prepare();
    await expect(changeProfilePassword({ ...input, userId: 'other' })).rejects.toMatchObject({ code: 'session-unavailable' });
    await expect(changeProfilePassword({ ...input, session: { ...input.session, expires_at: Math.floor(Date.now() / 1000) + 1 } }))
      .rejects.toMatchObject({ code: 'session-expiring' });
    const controller = new AbortController(); controller.abort();
    await expect(changeProfilePassword({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds a stalled SDK request even when its transport ignores abort', async () => {
    vi.useFakeTimers();
    const { input, fetcher } = prepare();
    fetcher.mockImplementation(() => new Promise<Response>(() => {}));
    const pending = changeProfilePassword(input);
    const rejected = expect(pending).rejects.toThrow('PROFILE_PASSWORD_TIMEOUT');
    await vi.advanceTimersByTimeAsync(15_000); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('acknowledges the update before bounded cleanup, even near the command deadline', async () => {
    vi.useFakeTimers();
    const { input, fetcher } = prepare();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (target, options) => {
      if (String(target).includes('/logout')) return new Promise<Response>(() => {});
      if (options?.method === 'PUT') await new Promise(resolve => setTimeout(resolve, 14_900));
      return original(target, options);
    });
    const pending = changeProfilePassword(input);
    await vi.advanceTimersByTimeAsync(14_900);
    const acknowledged = await pending;
    await vi.advanceTimersByTimeAsync(2_000); await acknowledged.cleanup;
    expect(vi.getTimerCount()).toBe(0);
  });
});
