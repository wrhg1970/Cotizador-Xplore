import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let sysAdmin: string;
let officeAdmin: string;
let quoter: string;

beforeAll(async () => {
  ctx = await makeApp();
  const office = (await makeOffice()).id;
  const login = async (role: 'SYSTEM_ADMIN' | 'OFFICE_ADMIN' | 'QUOTER') =>
    (await loginAs(ctx, (await makeUser([{ officeId: office, role }])).email)).cookie!;
  sysAdmin = await login('SYSTEM_ADMIN');
  officeAdmin = await login('OFFICE_ADMIN');
  quoter = await login('QUOTER');
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

const api = () => ctx.http();

describe('concept catalog (rubros)', () => {
  it('ships the EE sheet base concepts', async () => {
    const res = await api().get('/api/v1/concept-templates').set('Cookie', quoter).expect(200);
    const base = res.body.filter((t: { isBase: boolean }) => t.isBase);
    expect(base.map((t: { label: string }) => t.label)).toContain('Precio neto');
    expect(base.find((t: { label: string }) => t.label === 'Comisión escuela').internalOnly).toBe(true);
  });

  it('system admins create, rename and retire concepts, with audit; inactive ones hide from quoters', async () => {
    const label = `Excursión ${uniq()}`;
    const created = await api()
      .post('/api/v1/concept-templates')
      .set('Cookie', sysAdmin)
      .send({ label, category: 'PER_PARTICIPANT' })
      .expect(201);
    expect(created.body).toMatchObject({ label, isBase: false, internalOnly: false, active: true });
    await api()
      .post('/api/v1/concept-templates')
      .set('Cookie', sysAdmin)
      .send({ label, category: 'PER_PARTICIPANT' })
      .expect(409);
    await api()
      .patch(`/api/v1/concept-templates/${created.body.id}`)
      .set('Cookie', sysAdmin)
      .send({ active: false })
      .expect(200);
    const forQuoter = await api().get('/api/v1/concept-templates').set('Cookie', quoter).expect(200);
    expect(forQuoter.body.some((t: { id: string }) => t.id === created.body.id)).toBe(false);
    const forAdmin = await api().get('/api/v1/concept-templates').set('Cookie', sysAdmin).expect(200);
    expect(forAdmin.body.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
    const log = await prisma.auditLog.findMany({
      where: { entityId: created.body.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(log.map((l) => l.action)).toEqual(['concept_template.created', 'concept_template.updated']);
    expect(log[1]!.diff).toEqual({ active: { from: true, to: false } });
  });

  it('nobody else may change the catalog; bad input is rejected', async () => {
    const body = { label: `X ${uniq()}`, category: 'PER_GROUP' };
    await api().post('/api/v1/concept-templates').set('Cookie', officeAdmin).send(body).expect(403);
    await api().post('/api/v1/concept-templates').set('Cookie', quoter).send(body).expect(403);
    const any = (await api().get('/api/v1/concept-templates').set('Cookie', quoter)).body[0];
    await api()
      .patch(`/api/v1/concept-templates/${any.id}`)
      .set('Cookie', quoter)
      .send({ label: 'Hackeado' })
      .expect(403);
    await api().get('/api/v1/concept-templates').expect(401);
    await api()
      .post('/api/v1/concept-templates')
      .set('Cookie', sysAdmin)
      .send({ ...body, category: 'PER_ROOM' })
      .expect(400);
    await api()
      .post('/api/v1/concept-templates')
      .set('Cookie', sysAdmin)
      .send({ ...body, label: '   ' })
      .expect(400);
    await api()
      .patch(`/api/v1/concept-templates/${crypto.randomUUID()}`)
      .set('Cookie', sysAdmin)
      .send({ label: 'Nada' })
      .expect(404);
  });
});
