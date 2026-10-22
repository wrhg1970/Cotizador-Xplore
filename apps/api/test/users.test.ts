import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOMAIN, loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let officeA: { id: string };
let officeB: { id: string };
let sysAdmin: string;
let officeAdminA: string;
let quoterA: string;
let quoterAId: string;

beforeAll(async () => {
  ctx = await makeApp();
  officeA = await makeOffice();
  officeB = await makeOffice();
  const login = async (roles: Parameters<typeof makeUser>[0]) => {
    const u = await makeUser(roles);
    return { id: u.id, cookie: (await loginAs(ctx, u.email)).cookie! };
  };
  sysAdmin = (await login([{ officeId: officeA.id, role: 'SYSTEM_ADMIN' }])).cookie;
  officeAdminA = (await login([{ officeId: officeA.id, role: 'OFFICE_ADMIN' }])).cookie;
  const q = await login([{ officeId: officeA.id, role: 'QUOTER' }]);
  quoterA = q.cookie;
  quoterAId = q.id;
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('office scope (US-004, US-006)', () => {
  it('users only see their offices; system admin sees all', async () => {
    const mine = await ctx.http().get('/api/v1/offices').set('Cookie', quoterA).expect(200);
    expect(mine.body.map((o: { id: string }) => o.id)).toEqual([officeA.id]);
    const all = await ctx.http().get('/api/v1/offices').set('Cookie', sysAdmin).expect(200);
    expect(all.body.map((o: { id: string }) => o.id)).toEqual(
      expect.arrayContaining([officeA.id, officeB.id]),
    );
  });

  it('office admin cannot list another office (404, no data)', async () => {
    await ctx.http().get(`/api/v1/users?officeId=${officeA.id}`).set('Cookie', officeAdminA).expect(200);
    const res = await ctx
      .http()
      .get(`/api/v1/users?officeId=${officeB.id}`)
      .set('Cookie', officeAdminA)
      .expect(404);
    expect(JSON.stringify(res.body)).not.toContain('@');
  });

  it('only system admin creates offices', async () => {
    const body = { code: `N-${uniq()}`.toUpperCase(), name: 'Nueva' };
    await ctx.http().post('/api/v1/offices').set('Cookie', officeAdminA).send(body).expect(403);
    await ctx.http().post('/api/v1/offices').set('Cookie', sysAdmin).send(body).expect(201);
  });
});

describe('user administration (US-002, US-003)', () => {
  const invite = (officeId: string, role: string, email = `new-${uniq()}@${DOMAIN}`) => ({
    email,
    name: 'Nuevo',
    officeId,
    role,
  });

  it('office admin invites into own office, audited', async () => {
    const res = await ctx
      .http()
      .post('/api/v1/users')
      .set('Cookie', officeAdminA)
      .send(invite(officeA.id, 'ADVISOR'))
      .expect(201);
    expect(res.body.status).toBe('INVITED');
    expect(
      await prisma.auditLog.count({ where: { entityId: res.body.id, action: 'user.role_granted' } }),
    ).toBe(1);
  });

  it('office admin cannot invite into another office or grant admin roles', async () => {
    await ctx
      .http()
      .post('/api/v1/users')
      .set('Cookie', officeAdminA)
      .send(invite(officeB.id, 'ADVISOR'))
      .expect(403);
    await ctx
      .http()
      .post('/api/v1/users')
      .set('Cookie', officeAdminA)
      .send(invite(officeA.id, 'SYSTEM_ADMIN'))
      .expect(403);
    await ctx
      .http()
      .post('/api/v1/users')
      .set('Cookie', quoterA)
      .send(invite(officeA.id, 'ADVISOR'))
      .expect(403);
  });

  it('rejects disallowed email domains and unknown fields', async () => {
    const bad = await ctx
      .http()
      .post('/api/v1/users')
      .set('Cookie', sysAdmin)
      .send(invite(officeA.id, 'ADVISOR', 'x@gmail.com'))
      .expect(400);
    expect(bad.body.code).toBe('DOMAIN_NOT_ALLOWED');
    const extra = await ctx
      .http()
      .post('/api/v1/users')
      .set('Cookie', sysAdmin)
      .send({ ...invite(officeA.id, 'ADVISOR'), status: 'ACTIVE' })
      .expect(400);
    expect(extra.body.code).toBe('VALIDATION_ERROR');
  });

  it('disabling a user kills their session immediately (US-002)', async () => {
    const victim = await makeUser([{ officeId: officeA.id, role: 'ADVISOR' }]);
    const { cookie } = await loginAs(ctx, victim.email);
    await ctx.http().get('/api/v1/me').set('Cookie', cookie!).expect(200);
    await ctx.http().post(`/api/v1/users/${victim.id}/disable`).set('Cookie', officeAdminA).expect(403);
    await ctx.http().post(`/api/v1/users/${victim.id}/disable`).set('Cookie', sysAdmin).expect(204);
    await ctx.http().get('/api/v1/me').set('Cookie', cookie!).expect(401);
    const again = await loginAs(ctx, victim.email);
    expect(again.response.headers.location).toMatch(/error=DISABLED/);
  });

  it('role removal is scoped: other office ids look like 404', async () => {
    const userB = await makeUser([{ officeId: officeB.id, role: 'QUOTER' }]);
    const grant = await prisma.userOfficeRole.findFirstOrThrow({ where: { userId: userB.id } });
    await ctx
      .http()
      .delete(`/api/v1/users/${userB.id}/roles/${grant.id}`)
      .set('Cookie', officeAdminA)
      .expect(404);
    const grantA = await prisma.userOfficeRole.findFirstOrThrow({ where: { userId: quoterAId } });
    await ctx
      .http()
      .delete(`/api/v1/users/${quoterAId}/roles/${grantA.id}`)
      .set('Cookie', officeAdminA)
      .expect(204);
    // Role revoked → next request sees no offices.
    const offices = await ctx.http().get('/api/v1/offices').set('Cookie', quoterA).expect(200);
    expect(offices.body).toEqual([]);
  });
});
