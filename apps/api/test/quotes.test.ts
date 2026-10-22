import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let officeA: string;
const c: Record<'advisor' | 'quoter' | 'quoter2' | 'approver' | 'adminA' | 'adminB', string> = {} as never;
const ids: Record<string, string> = {};
let requestId: string;

beforeAll(async () => {
  ctx = await makeApp();
  officeA = (await makeOffice()).id;
  const officeB = (await makeOffice()).id;
  const login = async (
    key: keyof typeof c,
    officeId: string,
    role: Parameters<typeof makeUser>[0][number]['role'],
  ) => {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  };
  await login('advisor', officeA, 'ADVISOR');
  await login('quoter', officeA, 'QUOTER');
  await login('quoter2', officeA, 'QUOTER');
  await login('approver', officeA, 'APPROVER');
  await login('adminA', officeA, 'OFFICE_ADMIN');
  await login('adminB', officeB, 'OFFICE_ADMIN');

  const r = await api()
    .post('/api/v1/requests')
    .set('Cookie', c.advisor)
    .send({
      officeId: officeA,
      groupName: 'Italia Spring Break 2027',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: '2027-03-19',
      returnDate: '2027-04-04',
      participants: 10,
      staff: 2,
    })
    .expect(201);
  requestId = r.body.id;
  await api()
    .post(`/api/v1/requests/${requestId}/submit`)
    .set('Cookie', c.advisor)
    .send({ version: 1 })
    .expect(201);
  await api()
    .post(`/api/v1/requests/${requestId}/assign`)
    .set('Cookie', c.adminA)
    .send({ assigneeId: ids.quoter, version: 2 })
    .expect(201);
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

const api = () => ctx.http();
const newScenario = (cookie: string, body: object = { name: 'Opción 1', saleCurrency: 'EUR' }) =>
  api().post(`/api/v1/requests/${requestId}/scenarios`).set('Cookie', cookie).send(body);

// Finance's sheet, "Opción 1": price 5128.05 EUR per student.
const option1 = {
  targetMarginRate: '0.18',
  lines: [
    {
      category: 'PER_PARTICIPANT',
      description: 'Precio neto',
      quantity: '1',
      unitCost: '3900',
      currency: 'EUR',
    },
    { category: 'PER_PARTICIPANT', description: 'Kit EE', quantity: '1', unitCost: '50', currency: 'EUR' },
    { category: 'PER_PARTICIPANT', description: 'Promoción', quantity: '1', unitCost: '20', currency: 'EUR' },
    {
      category: 'PER_PARTICIPANT',
      description: 'Envío de kits',
      quantity: '1',
      unitCost: '10',
      currency: 'EUR',
    },
    { category: 'PER_PARTICIPANT', description: 'Operación', quantity: '1', unitCost: '40', currency: 'EUR' },
    {
      category: 'PER_STAFF',
      description: 'Viáticos 16 días',
      quantity: '16',
      unitCost: '50',
      currency: 'EUR',
    },
    { category: 'PER_STAFF', description: 'Kit chaperón', quantity: '1', unitCost: '50', currency: 'EUR' },
    {
      category: 'CONTINGENCY',
      description: 'Fondo de emergencia',
      quantity: '1',
      unitCost: '150',
      currency: 'EUR',
    },
  ],
};

describe('scenarios (US-029, US-030, US-031)', () => {
  it('assignee creates a scenario with v1 draft and counts from the request', async () => {
    const res = await newScenario(c.quoter).expect(201);
    expect(res.body.latest).toMatchObject({
      number: 1,
      status: 'DRAFT',
      participants: 10,
      chaperones: 0,
      staff: 2,
      saleCurrency: 'EUR',
      lines: [],
    });
  });

  it('only the assignee or office admin can create; others in the office get 403, other offices 404', async () => {
    await newScenario(c.adminA).expect(201);
    await newScenario(c.quoter2).expect(403);
    await newScenario(c.approver).expect(403);
    await newScenario(c.adminB).expect(404);
    await newScenario(c.advisor).expect(404); // advisors never see internal costs
  });

  it('edits a draft, calculates like the Finance sheet and guards concurrency', async () => {
    const s = (await newScenario(c.quoter).expect(201)).body;
    const v = s.latest;
    const res = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ ...option1, rowVersion: v.rowVersion })
      .expect(200);
    expect(res.body.rowVersion).toBe(2);
    expect(res.body.lines.map((l: { description: string }) => l.description)[0]).toBe('Precio neto');
    expect(res.body.totals).toMatchObject({
      sharedPerParticipant: '185.00',
      costPerParticipant: '4205.00',
      marginPerParticipant: '923.05',
      pricePerParticipant: '5128.05',
      groupMargin: '9230.49',
    });
    // Stale rowVersion
    const stale = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ participants: 15, rowVersion: 1 })
      .expect(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    expect(await prisma.auditLog.count({ where: { entityId: v.id, action: 'quote.version.updated' } })).toBe(
      1,
    );
    // Approver may read costs, advisor may not.
    await api().get(`/api/v1/quotes/${v.id}`).set('Cookie', c.approver).expect(200);
    await api().get(`/api/v1/quotes/${v.id}`).set('Cookie', c.advisor).expect(404);
  });

  it('flags foreign-currency lines without FX and prices them once a rate is recorded', async () => {
    const v = (await newScenario(c.quoter).expect(201)).body.latest;
    const line = {
      category: 'PER_GROUP',
      description: 'Bus',
      quantity: '1',
      unitCost: '2039',
      currency: 'MXN',
    };
    const r1 = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ lines: [line], rowVersion: 1 })
      .expect(200);
    expect(r1.body.totals).toBeNull();
    expect(r1.body.warnings[0].code).toBe('MISSING_FX');
    const r2 = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({
        fxRates: [{ fromCurrency: 'MXN', rate: '0.05', rateDate: '2026-10-22', source: 'Banxico' }],
        rowVersion: 2,
      })
      .expect(200);
    expect(r2.body.warnings).toEqual([]);
    expect(r2.body.fxRates[0]).toMatchObject({ fromCurrency: 'MXN', toCurrency: 'EUR', rate: '0.05' });
    expect(r2.body.totals.sharedPerParticipant).toBe('10.20');
    // Changing the sale currency without new rates would misprice.
    const r3 = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ saleCurrency: 'USD', rowVersion: 3 })
      .expect(400);
    expect(r3.body.code).toBe('FX_REQUIRED');
  });

  it('duplicates a scenario without touching the original', async () => {
    const s = (await newScenario(c.quoter).expect(201)).body;
    await api()
      .patch(`/api/v1/quotes/${s.latest.id}`)
      .set('Cookie', c.quoter)
      .send({ ...option1, rowVersion: 1 })
      .expect(200);
    const dup = (
      await api()
        .post(`/api/v1/scenarios/${s.id}/duplicate`)
        .set('Cookie', c.quoter)
        .send({ name: 'Opción 2' })
        .expect(201)
    ).body;
    expect(dup.id).not.toBe(s.id);
    expect(dup.latest.lines).toHaveLength(8);
    expect(dup.latest.targetMarginRate).toBe('0.18');
    await api()
      .patch(`/api/v1/quotes/${dup.latest.id}`)
      .set('Cookie', c.quoter)
      .send({ participants: 15, rowVersion: 1 })
      .expect(200);
    const original = await api().get(`/api/v1/quotes/${s.latest.id}`).set('Cookie', c.quoter).expect(200);
    expect(original.body.participants).toBe(10);
    expect(original.body.totals.pricePerParticipant).toBe('5128.05');

    const list = await api()
      .get(`/api/v1/requests/${requestId}/scenarios`)
      .set('Cookie', c.approver)
      .expect(200);
    expect(list.body.map((x: { name: string }) => x.name)).toContain('Opción 2');
  });

  it('a new version is only created once the previous one left draft', async () => {
    const s = (await newScenario(c.quoter).expect(201)).body;
    const res = await api().post(`/api/v1/scenarios/${s.id}/versions`).set('Cookie', c.quoter).expect(409);
    expect(res.body.code).toBe('DRAFT_EXISTS');
    await prisma.quoteVersion.update({ where: { id: s.latest.id }, data: { status: 'SENT' } });
    const v2 = await api().post(`/api/v1/scenarios/${s.id}/versions`).set('Cookie', c.quoter).expect(201);
    expect(v2.body).toMatchObject({ number: 2, status: 'DRAFT' });
    await api()
      .patch(`/api/v1/quotes/${s.latest.id}`)
      .set('Cookie', c.quoter)
      .send({ rowVersion: 1 })
      .expect(403);
  });

  it('database rejects invalid margins and amounts even if the API were bypassed', async () => {
    const v = (await newScenario(c.quoter).expect(201)).body.latest;
    await expect(
      prisma.quoteVersion.update({ where: { id: v.id }, data: { targetMarginRate: 1 } }),
    ).rejects.toThrow();
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ targetMarginRate: '1', rowVersion: 1 })
      .expect(400);
  });
});
