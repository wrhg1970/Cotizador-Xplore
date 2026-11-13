import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schoolKey } from '../src/schools/schools.controller.js';
import { loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<string, string> = {};
const ids: Record<string, string> = {};
let officeA: string;
const SCHOOL = `Colegio Ficha ${uniq()}`;

const request = (status: 'SENT' | 'WON' | 'LOST' | 'DRAFT', clientName: string, departure: string) =>
  prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${uniq().toUpperCase()}`,
      officeId: officeA,
      requesterId: ids.advisor!,
      status,
      groupName: `Viaje ${departure}`,
      clientName,
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date(departure),
      returnDate: new Date(departure),
      participants: 10,
      ...(status === 'LOST' ? { lostReason: 'Precio' } : {}),
    },
  });

beforeAll(async () => {
  ctx = await makeApp();
  officeA = (await makeOffice()).id;
  const officeB = (await makeOffice()).id;
  for (const [key, officeId, role] of [
    ['advisor', officeA, 'ADVISOR'],
    ['other', officeA, 'ADVISOR'],
    ['admin', officeA, 'OFFICE_ADMIN'],
    ['auditor', officeA, 'AUDITOR'],
    ['sys', officeA, 'SYSTEM_ADMIN'],
    ['outsider', officeB, 'OFFICE_ADMIN'],
  ] as const) {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  }
  await request('LOST', SCHOOL, '2025-03-01');
  await request('SENT', `  ${SCHOOL.toUpperCase()} `, '2026-03-01');
  await request('DRAFT', SCHOOL, '2027-03-01');
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('ficha por colegio', () => {
  it('normalizes names', () => {
    expect(schoolKey('  Colegio Américano  de Monterrey ')).toBe('colegio americano de monterrey');
  });

  it('groups trips by school in my offices, with conversion; other offices see nothing', async () => {
    const list = (await ctx.http().get('/api/v1/schools').set('Cookie', c.other!).expect(200)).body;
    const s = list.find((x: { key: string }) => x.key === schoolKey(SCHOOL));
    // The draft stays private to its author.
    expect(s).toMatchObject({ requests: 2, won: 0, lost: 1, conversion: 0, lastDeparture: '2026-03-01' });
    const outsider = (await ctx.http().get('/api/v1/schools').set('Cookie', c.outsider!).expect(200)).body;
    expect(outsider.some((x: { key: string }) => x.key === schoolKey(SCHOOL))).toBe(false);
    await ctx
      .http()
      .get('/api/v1/schools/detail')
      .query({ officeId: officeA, key: schoolKey(SCHOOL) })
      .set('Cookie', c.outsider!)
      .expect(404);
  });

  it('adds and removes contacts, audited by office', async () => {
    const add = (cookie: string, body: object) =>
      ctx.http().post('/api/v1/schools/contacts').set('Cookie', cookie).send(body);
    const contact = {
      officeId: officeA,
      schoolName: SCHOOL,
      name: 'Laura Pérez',
      role: 'Coordinadora',
      email: 'laura@colegio.mx',
    };
    await add(c.advisor!, { ...contact, email: 'no-es-correo' }).expect(400);
    await add(c.outsider!, contact).expect(404);
    const id = (await add(c.advisor!, contact).expect(201)).body.id;
    const d = (
      await ctx
        .http()
        .get('/api/v1/schools/detail')
        .query({ officeId: officeA, key: schoolKey(SCHOOL) })
        .set('Cookie', c.advisor!)
        .expect(200)
    ).body;
    expect(d.trips).toHaveLength(3);
    expect(d.contacts).toEqual([expect.objectContaining({ id, name: 'Laura Pérez', role: 'Coordinadora' })]);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'school.contact_added', entityId: id },
    });
    expect(log.officeId).toBe(officeA);
    expect(JSON.stringify(log.diff)).not.toContain('Laura');
    await ctx.http().delete(`/api/v1/schools/contacts/${id}`).set('Cookie', c.other!).expect(403);
    await ctx.http().delete(`/api/v1/schools/contacts/${id}`).set('Cookie', c.admin!).expect(200);
  });

  it('saves the ficha of a school from requests, keeps its contacts after a rename, audits field names only', async () => {
    const key = schoolKey(SCHOOL);
    const save = (cookie: string, body: object) =>
      ctx.http().put('/api/v1/schools/client').set('Cookie', cookie).send(body);
    const data = {
      officeId: officeA,
      key,
      name: 'Colegio Renombrado',
      taxId: 'cam850101ab1',
      city: 'Monterrey',
    };
    await save(c.advisor!, { ...data, website: 'cam.edu.mx' }).expect(400);
    await save(c.outsider!, data).expect(404);
    await save(c.auditor!, data).expect(403);
    await save(c.advisor!, data).expect(200);
    await ctx
      .http()
      .post('/api/v1/schools/contacts')
      .set('Cookie', c.advisor!)
      .send({ officeId: officeA, key, schoolName: 'Colegio Renombrado', name: 'Ana' })
      .expect(201);
    const list = (await ctx.http().get('/api/v1/schools').set('Cookie', c.other!)).body;
    expect(list.find((x: { key: string }) => x.key === key)).toMatchObject({
      name: 'Colegio Renombrado',
      taxId: 'CAM850101AB1',
      city: 'Monterrey',
      requests: 2,
      wissifyId: null,
      contact: { name: 'Ana' },
    });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'client.created', officeId: officeA },
    });
    expect(JSON.stringify(log.diff)).not.toContain('CAM850101AB1');
    // Clearing a field stores null.
    await save(c.advisor!, { ...data, city: '' }).expect(200);
    const row = await prisma.client.findUniqueOrThrow({
      where: { officeId_key: { officeId: officeA, key } },
    });
    expect(row.city).toBeNull();
  });

  it('"Nuevo cliente" without requests shows in the list; a second one with the same name is a conflict', async () => {
    const name = `Cliente Nuevo ${uniq()}`;
    const body = { officeId: officeA, name, kind: 'Empresa' };
    const r = (
      await ctx.http().put('/api/v1/schools/client').set('Cookie', c.advisor!).send(body).expect(200)
    ).body;
    expect(r.key).toBe(schoolKey(name));
    await ctx.http().put('/api/v1/schools/client').set('Cookie', c.advisor!).send(body).expect(409);
    const list = (await ctx.http().get('/api/v1/schools').set('Cookie', c.other!)).body;
    expect(list.find((x: { key: string }) => x.key === r.key)).toMatchObject({
      requests: 0,
      kind: 'Empresa',
    });
    const d = await ctx
      .http()
      .get('/api/v1/schools/detail')
      .query({ officeId: officeA, key: r.key })
      .set('Cookie', c.other!)
      .expect(200);
    expect(d.body).toMatchObject({ name, trips: [], canEdit: true });
  });

  it('system admins delete only clients without requests; contacts go with them; audited', async () => {
    const del = (cookie: string, key: string) =>
      ctx.http().delete('/api/v1/schools/client').query({ officeId: officeA, key }).set('Cookie', cookie);
    await del(c.sys!, schoolKey(SCHOOL)).expect(409);
    const name = `Cliente Vacío ${uniq()}`;
    const { key } = (
      await ctx
        .http()
        .put('/api/v1/schools/client')
        .set('Cookie', c.advisor!)
        .send({ officeId: officeA, name })
        .expect(200)
    ).body;
    await ctx
      .http()
      .post('/api/v1/schools/contacts')
      .set('Cookie', c.advisor!)
      .send({ officeId: officeA, key, schoolName: name, name: 'Ana' })
      .expect(201);
    await del(c.admin!, key).expect(403);
    await del(c.outsider!, key).expect(404);
    await del(c.sys!, key).expect(200);
    expect(await prisma.schoolContact.count({ where: { officeId: officeA, schoolKey: key } })).toBe(0);
    await prisma.auditLog.findFirstOrThrow({ where: { action: 'client.deleted', officeId: officeA } });
    await del(c.sys!, key).expect(404);
  });
});
