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
});
