import type { EditableRole } from '@ee/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_POLICIES } from '../src/auth/authz.js';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'sysadmin' | 'advisor' | 'quoter' | 'adminA', string> = {} as never;
const ids: Record<string, string> = {};
let officeA: string;
let officeB: string;

const api = () => ctx.http();
const setPolicy = (role: EditableRole, changes: object) =>
  api()
    .put(`/api/v1/role-policies/${role}`)
    .set('Cookie', c.sysadmin)
    .send({ ...DEFAULT_POLICIES[role], ...changes })
    .expect(200);
const newRequest = (cookie: string, officeId = officeA) =>
  api().post('/api/v1/requests').set('Cookie', cookie).send({
    officeId,
    groupName: 'Permisos 2027',
    city: 'Roma',
    countryCode: 'IT',
    departureDate: '2027-03-19',
    returnDate: '2027-03-25',
    participants: 10,
  });

beforeAll(async () => {
  ctx = await makeApp();
  officeA = (await makeOffice()).id;
  officeB = (await makeOffice()).id;
  const login = async (key: keyof typeof c, role: Parameters<typeof makeUser>[0][number]['role']) => {
    const u = await makeUser([{ officeId: officeA, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  };
  await login('sysadmin', 'SYSTEM_ADMIN');
  await login('advisor', 'ADVISOR');
  await login('quoter', 'QUOTER');
  await login('adminA', 'OFFICE_ADMIN');
});
afterAll(async () => {
  for (const role of Object.keys(DEFAULT_POLICIES) as EditableRole[]) await setPolicy(role, {});
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('Ver / Crear / Editar / Borrar per role', () => {
  it('defaults keep the previous rules', async () => {
    await newRequest(c.advisor).expect(201);
    await newRequest(c.quoter).expect(403);
    const me = (await api().get('/api/v1/me').set('Cookie', c.quoter).expect(200)).body;
    expect(me.policies.QUOTER).toMatchObject({
      canView: true,
      canCreate: false,
      canEdit: true,
      canDelete: false,
    });
  });

  it('Crear decides who opens requests', async () => {
    await setPolicy('ADVISOR', { canCreate: false });
    await newRequest(c.advisor).expect(403);
    await setPolicy('QUOTER', { canCreate: true });
    await newRequest(c.quoter).expect(201);
    await newRequest(c.quoter, officeB).expect(403); // only in its own offices
    await setPolicy('ADVISOR', {});
    await setPolicy('QUOTER', {});
  });

  it('Editar blocks edits even on your own request', async () => {
    const r = (await newRequest(c.advisor).expect(201)).body;
    await setPolicy('ADVISOR', { canEdit: false });
    await api()
      .patch(`/api/v1/requests/${r.id}`)
      .set('Cookie', c.advisor)
      .send({ version: 1, city: 'Milán' })
      .expect(403);
    await setPolicy('ADVISOR', {});
    await api()
      .patch(`/api/v1/requests/${r.id}`)
      .set('Cookie', c.advisor)
      .send({ version: 1, city: 'Milán' })
      .expect(200);
  });

  it('Borrar lets a role cancel requests of its office', async () => {
    const r = (await newRequest(c.advisor).expect(201)).body;
    await api()
      .post(`/api/v1/requests/${r.id}/submit`)
      .set('Cookie', c.advisor)
      .send({ version: 1 })
      .expect(201);
    const cancel = (cookie: string) =>
      api()
        .post(`/api/v1/requests/${r.id}/cancel`)
        .set('Cookie', cookie)
        .send({ reason: 'Prueba', version: 2 });
    await cancel(c.quoter).expect(403);
    await setPolicy('QUOTER', { canDelete: true });
    await cancel(c.quoter).expect(201);
    await setPolicy('QUOTER', {});
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: r.id, action: 'request.cancelled' },
    });
    expect(log.actorUserId).toBe(ids.quoter);
  });

  it('without Ver the office disappears for that role', async () => {
    const r = (await newRequest(c.advisor).expect(201)).body;
    await api()
      .post(`/api/v1/requests/${r.id}/submit`)
      .set('Cookie', c.advisor)
      .send({ version: 1 })
      .expect(201);
    await api().get(`/api/v1/requests/${r.id}`).set('Cookie', c.quoter).expect(200);
    await setPolicy('QUOTER', { canView: false });
    await api().get(`/api/v1/requests/${r.id}`).set('Cookie', c.quoter).expect(404);
    const offices = (await api().get('/api/v1/offices').set('Cookie', c.quoter).expect(200)).body as {
      id: string;
    }[];
    expect(offices.some((o) => o.id === officeA)).toBe(false);
    await setPolicy('QUOTER', {});
  });
});

describe('offices per user', () => {
  it('a system admin sets the offices where the user privileges apply, audited', async () => {
    const u = await makeUser([
      { officeId: officeA, role: 'QUOTER' },
      { officeId: officeA, role: 'ADVISOR' },
    ]);
    const put = (cookie: string, officeIds: string[]) =>
      api().put(`/api/v1/users/${u.id}/offices`).set('Cookie', cookie).send({ officeIds });

    await put(c.sysadmin, [officeB]).expect(200);
    const grants = await prisma.userOfficeRole.findMany({ where: { userId: u.id } });
    expect(grants.map((g) => `${g.officeId === officeB ? 'B' : 'A'}:${g.role}`).sort()).toEqual([
      'B:ADVISOR',
      'B:QUOTER',
    ]);

    await put(c.sysadmin, [officeA, officeB]).expect(200);
    expect(await prisma.userOfficeRole.count({ where: { userId: u.id } })).toBe(4);

    const listed = (
      await api().get(`/api/v1/users?officeId=${officeA}`).set('Cookie', c.sysadmin).expect(200)
    ).body;
    expect(listed.find((x: { id: string }) => x.id === u.id).officeIds.sort()).toEqual(
      [officeA, officeB].sort(),
    );
    const forAdmin = (
      await api().get(`/api/v1/users?officeId=${officeA}`).set('Cookie', c.adminA).expect(200)
    ).body;
    expect(forAdmin.find((x: { id: string }) => x.id === u.id).officeIds).toBeUndefined();

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: u.id, action: 'user.offices_updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.diff).toMatchObject({ roles: expect.arrayContaining(['QUOTER', 'ADVISOR']) });
  });

  it('refuses non system admins, unknown offices, users without privileges and bad bodies', async () => {
    const u = await makeUser([{ officeId: officeA, role: 'QUOTER' }]);
    const put = (cookie: string, body: object, id = u.id) =>
      api().put(`/api/v1/users/${id}/offices`).set('Cookie', cookie).send(body);
    await put(c.adminA, { officeIds: [officeA] }).expect(403);
    await put(c.sysadmin, { officeIds: [crypto.randomUUID()] }).expect(404);
    await put(c.sysadmin, { officeIds: [] }).expect(400);
    await put(c.sysadmin, { officeIds: ['x'] }).expect(400);
    const bare = await makeUser([]);
    await put(c.sysadmin, { officeIds: [officeA] }, bare.id).expect(400);
    await put(c.sysadmin, { officeIds: [officeA] }, crypto.randomUUID()).expect(404);
  });

  it('never touches the system admin privilege', async () => {
    const u = await makeUser([
      { officeId: officeA, role: 'SYSTEM_ADMIN' },
      { officeId: officeA, role: 'AUDITOR' },
    ]);
    await api()
      .put(`/api/v1/users/${u.id}/offices`)
      .set('Cookie', c.sysadmin)
      .send({ officeIds: [officeB] })
      .expect(200);
    const grants = await prisma.userOfficeRole.findMany({ where: { userId: u.id } });
    expect(grants.some((g) => g.role === 'SYSTEM_ADMIN' && g.officeId === officeA)).toBe(true);
    expect(grants.some((g) => g.role === 'AUDITOR' && g.officeId === officeA)).toBe(false);
  });
});
