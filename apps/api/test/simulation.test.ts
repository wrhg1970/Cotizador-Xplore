import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeAgency, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let officeA: string;
let officeB: string;
let admin: string;
let adminId: string;
let advisorId: string;
let otherAgencyUser: string;
let advisorCookie: string;

beforeAll(async () => {
  ctx = await makeApp();
  officeA = (await makeOffice()).id;
  officeB = (await makeOffice()).id;
  const a = await makeUser([{ officeId: officeA, role: 'SYSTEM_ADMIN' }]);
  adminId = a.id;
  admin = (await loginAs(ctx, a.email)).cookie!;
  const adv = await makeUser([{ officeId: officeB, role: 'ADVISOR' }], 'ACTIVE');
  advisorId = adv.id;
  advisorCookie = (await loginAs(ctx, adv.email)).cookie!;
  const agency = await makeAgency();
  const office = await prisma.office.create({ data: { agencyId: agency.id, code: 'X-SIM', name: 'Otra' } });
  otherAgencyUser = (await makeUser([{ officeId: office.id, role: 'ADVISOR' }], 'ACTIVE', agency.id)).id;
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

const api = () => ctx.http();

describe('"Ver como" (simulate another user)', () => {
  it('only system admins list and start it, and only for users of their agency', async () => {
    await api().get('/api/v1/simulation/users').set('Cookie', advisorCookie).expect(403);
    await api().post('/api/v1/simulation').set('Cookie', advisorCookie).send({ userId: adminId }).expect(403);
    const list = await api().get('/api/v1/simulation/users').set('Cookie', admin).expect(200);
    const ids = (list.body as { id: string }[]).map((u) => u.id);
    expect(ids).toContain(advisorId);
    expect(ids).not.toContain(otherAgencyUser);
    expect(ids).not.toContain(adminId);
    await api().post('/api/v1/simulation').set('Cookie', admin).send({ userId: otherAgencyUser }).expect(404);
  });

  it('shows the target user’s roles, refuses writes, and audits with the real admin', async () => {
    await api().post('/api/v1/simulation').set('Cookie', admin).send({ userId: advisorId }).expect(204);
    const me = await api().get('/api/v1/me').set('Cookie', admin).expect(200);
    expect(me.body).toMatchObject({
      id: advisorId,
      roles: [{ officeId: officeB, role: 'ADVISOR' }],
      simulatedBy: { id: adminId },
    });
    const offices = await api().get('/api/v1/offices').set('Cookie', admin).expect(200);
    expect((offices.body as { id: string }[]).map((o) => o.id)).toEqual([officeB]);

    const write = await api()
      .post('/api/v1/requests')
      .set('Cookie', admin)
      .send({ officeId: officeB, groupName: 'x' })
      .expect(403);
    expect(JSON.stringify(write.body)).toContain('solo lectura');
    // Cannot chain into another simulation either.
    await api().post('/api/v1/simulation').set('Cookie', admin).send({ userId: advisorId }).expect(403);

    await api().delete('/api/v1/simulation').set('Cookie', admin).expect(204);
    const back = await api().get('/api/v1/me').set('Cookie', admin).expect(200);
    expect(back.body.id).toBe(adminId);
    expect(back.body.simulatedBy).toBeUndefined();

    const log = await prisma.auditLog.findMany({
      where: { entityId: advisorId, action: { startsWith: 'auth.simulation' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(log.map((l) => [l.action, l.actorUserId])).toEqual([
      ['auth.simulation_started', adminId],
      ['auth.simulation_ended', adminId],
    ]);
  });

  it('ends when the admin loses the role', async () => {
    await api().post('/api/v1/simulation').set('Cookie', admin).send({ userId: advisorId }).expect(204);
    await prisma.userOfficeRole.deleteMany({ where: { userId: adminId } });
    await prisma.userOfficeRole.create({ data: { userId: adminId, officeId: officeA, role: 'ADVISOR' } });
    const me = await api().get('/api/v1/me').set('Cookie', admin).expect(200);
    expect(me.body.id).toBe(adminId);
    expect(me.body.simulatedBy).toBeUndefined();
  });
});
