import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOMAIN, loginAs, makeApp, makeOffice, makeUser, prisma, WEB } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('Google login (US-001)', () => {
  it('invited user logs in, becomes ACTIVE, gets an HttpOnly session and an audit entry', async () => {
    const office = await makeOffice();
    const user = await makeUser([{ officeId: office.id, role: 'QUOTER' }]);
    const { response, cookie } = await loginAs(ctx, user.email);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(WEB);
    expect(cookie).toBeDefined();
    expect((response.headers['set-cookie'] as unknown as string[]).join()).toMatch(/ee_session=.*HttpOnly/);

    const me = await ctx.http().get('/api/v1/me').set('Cookie', cookie!).expect(200);
    expect(me.body).toMatchObject({ email: user.email, roles: [{ officeId: office.id, role: 'QUOTER' }] });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.status).toBe('ACTIVE');
    expect(await prisma.auditLog.count({ where: { actorUserId: user.id, action: 'auth.login' } })).toBe(1);
    // Only the hash is stored.
    const raw = cookie!.split('=')[1]!;
    expect(await prisma.session.count({ where: { tokenHash: raw } })).toBe(0);
  });

  it.each([
    ['not invited', { email: `nobody@${DOMAIN}` }, 'NOT_INVITED'],
    ['unverified email', { email_verified: false }, 'EMAIL_NOT_VERIFIED'],
    ['gmail account (no hd)', { hd: undefined }, 'DOMAIN_NOT_ALLOWED'],
    ['other Workspace domain', { hd: 'other.example', email: 'x@other.example' }, 'DOMAIN_NOT_ALLOWED'],
  ])('rejects %s', async (_label, patch, reason) => {
    const user = await makeUser([]);
    const base = { sub: `s-${user.id}`, email: user.email, email_verified: true, hd: DOMAIN };
    ctx.oidc.claims = { ...base, ...patch };
    const start = await ctx.http().get('/api/v1/auth/google/login').expect(302);
    const state = new URL(start.headers.location as string).searchParams.get('state');
    const cookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    // Keep the patched claims (loginAs would overwrite them).
    const cb = await ctx
      .http()
      .get(`/api/v1/auth/google/callback?code=x&state=${state}`)
      .set('Cookie', cookie);
    expect(cb.headers.location).toBe(`${WEB}/login?error=${reason}`);
    expect((cb.headers['set-cookie'] as unknown as string[]).join()).not.toMatch(/ee_session=[^;]/);
  });

  it('rejects a forged state and a callback without the login cookie', async () => {
    const user = await makeUser([]);
    ctx.oidc.claims = { sub: 's', email: user.email, email_verified: true, hd: DOMAIN };
    const start = await ctx.http().get('/api/v1/auth/google/login').expect(302);
    const cookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const forged = await ctx
      .http()
      .get('/api/v1/auth/google/callback?code=x&state=evil')
      .set('Cookie', cookie);
    expect(forged.headers.location).toBe(`${WEB}/login?error=LOGIN_FAILED`);
    const noCookie = await ctx.http().get('/api/v1/auth/google/callback?code=x&state=evil');
    expect(noCookie.headers.location).toBe(`${WEB}/login?error=LOGIN_EXPIRED`);
  });

  it('moves a login opened on another host to the callback host before setting the cookie', async () => {
    const res = await ctx
      .http()
      .get('/api/v1/auth/google/login')
      .set('X-Forwarded-Host', 'cotizador-web-prod-1.us-central1.run.app')
      .expect(302);
    expect(res.headers.location).toBe('http://127.0.0.1:4000/api/v1/auth/google/login');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a tampered (unsigned) login cookie', async () => {
    const checks = JSON.stringify({ state: 'a', nonce: 'b', codeVerifier: 'c' });
    const res = await ctx
      .http()
      .get('/api/v1/auth/google/callback?code=x&state=a')
      .set('Cookie', `ee_oidc=${encodeURIComponent(checks)}`);
    expect(res.headers.location).toBe(`${WEB}/login?error=LOGIN_EXPIRED`);
  });

  it('rejects a different Google account for an already bound email', async () => {
    const user = await makeUser([]);
    const first = await loginAs(ctx, user.email, `orig-${user.id}`);
    expect(first.cookie).toBeDefined();
    const second = await loginAs(ctx, user.email, `impostor-${user.id}`);
    expect(second.response.headers.location).toBe(`${WEB}/login?error=ACCOUNT_MISMATCH`);
  });
});

describe('sessions (US-007, US-002)', () => {
  it('requires a session for protected routes', async () => {
    const res = await ctx.http().get('/api/v1/me').expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    await ctx.http().get('/api/v1/me').set('Cookie', 'ee_session=garbage').expect(401);
  });

  it('logout invalidates the session server-side', async () => {
    const user = await makeUser([]);
    const { cookie } = await loginAs(ctx, user.email);
    await ctx.http().post('/api/v1/auth/logout').set('Cookie', cookie!).expect(204);
    await ctx.http().get('/api/v1/me').set('Cookie', cookie!).expect(401);
  });

  it('expired sessions are rejected', async () => {
    const user = await makeUser([]);
    const { cookie } = await loginAs(ctx, user.email);
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await ctx.http().get('/api/v1/me').set('Cookie', cookie!).expect(401);
  });

  it('blocks state-changing requests from a foreign origin', async () => {
    const user = await makeUser([]);
    const { cookie } = await loginAs(ctx, user.email);
    await ctx
      .http()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie!)
      .set('Origin', 'https://evil.example')
      .expect(403);
  });
});

describe('login rate limit (US-182)', () => {
  it('returns 429 after 10 login attempts per minute', async () => {
    const { createApp } = await import('../src/app.js');
    const { testEnv, FakeOidc } = await import('./helpers.js');
    const app = await createApp(testEnv({ NODE_ENV: 'development' }), new FakeOidc());
    await app.init();
    try {
      const request = (await import('supertest')).default;
      for (let i = 0; i < 10; i++)
        await request(app.getHttpServer()).get('/api/v1/auth/google/login').expect(302);
      await request(app.getHttpServer()).get('/api/v1/auth/google/login').expect(429);
    } finally {
      await app.close();
    }
  });
});
