import ExcelJS from 'exceljs';
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

// Finance's sheet, "Opción 1": 5128.05 EUR per student, rounded up to 5129.
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
    });
    // Starts with the EE sheet's base concepts at zero; allowances count the trip's 17 days.
    const lines = res.body.latest.lines as { description: string; category: string; quantity: string }[];
    expect(lines[0]).toMatchObject({
      description: 'Precio neto',
      category: 'PER_PARTICIPANT',
      unitCost: '0',
    });
    expect(
      lines.find((l) => l.description === 'Gastos por día' && l.category === 'PER_STAFF')?.quantity,
    ).toBe('17');
    expect(lines.some((l) => l.category === 'PER_CHAPERONE')).toBe(false); // optional, not base
    expect(lines.at(-1)).toMatchObject({ description: 'Fondo de emergencia', category: 'CONTINGENCY' });
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
      marginPerParticipant: '924.00',
      pricePerParticipant: '5129.00',
      groupMargin: '9240.00',
      pricePerParticipantMxn: null,
    });
    const mxn = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ mxnRate: '20.39', rowVersion: 2 })
      .expect(200);
    expect(mxn.body.totals).toMatchObject({
      pricePerParticipantMxn: '104581.00',
      groupMarginMxn: '188403.60',
    });
    // EE sheet rows: (2 × (16 × 50 + 50)) chaperones + 150 fund = 1850, ÷ 10 students.
    expect(res.body.sheet).toEqual({
      chaperonesTotal: '1700.00',
      emergencyFund: '150.00',
      totalChaperones: '1850.00',
      leaderPerParticipant: '185.00',
      groupFixedTotal: '0.00',
      groupFixedPerParticipant: '0.00',
    });
    // Volume table: same costs and 18% margin; the 1850 of chaperones spreads over 20 → 4112.50 / 0.82, rounded up.
    expect(res.body.volumePrices.map((p: { participants: number }) => p.participants)).toEqual([
      15, 20, 25, 30, 35,
    ]);
    expect(res.body.volumePrices[1]).toEqual({ participants: 20, pricePerParticipant: '5016.00' });
    // Stale rowVersion
    const stale = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ participants: 15, rowVersion: 1 })
      .expect(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    expect(await prisma.auditLog.count({ where: { entityId: v.id, action: 'quote.version.updated' } })).toBe(
      2,
    );
    // Approver may read costs, advisor may not.
    await api().get(`/api/v1/quotes/${v.id}`).set('Cookie', c.approver).expect(200);
    await api().get(`/api/v1/quotes/${v.id}`).set('Cookie', c.advisor).expect(404);
  });

  it('keeps a note per line on the sheet, never on the client proposal', async () => {
    const v = (await newScenario(c.quoter).expect(201)).body.latest;
    const [first, ...rest] = option1.lines;
    const res = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ lines: [{ ...first, note: 'avión' }, ...rest], rowVersion: 1 })
      .expect(200);
    expect(res.body.lines[0].note).toBe('avión');
    expect(res.body.lines[1].note).toBeNull();
    const p = await api().get(`/api/v1/quotes/${v.id}/proposal`).set('Cookie', c.quoter).expect(200);
    expect(JSON.stringify(p.body)).not.toContain('avión');
  });

  it('derives the margin from a typed final price and refuses one below cost', async () => {
    const v = (await newScenario(c.quoter).expect(201)).body.latest;
    const res = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ lines: option1.lines, targetPricePerParticipant: '5150', rowVersion: 1 })
      .expect(200);
    expect(res.body.targetMarginRate).toBe('0.183495'); // 1 − 4205/5150, truncated
    expect(res.body.totals).toMatchObject({ pricePerParticipant: '5150.00', marginPerParticipant: '945.00' });
    const low = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ targetPricePerParticipant: '4000', rowVersion: 2 })
      .expect(400);
    expect(low.body.code).toBe('PRICE_BELOW_COST');
    // Nothing from the refused edit was kept.
    const after = await api().get(`/api/v1/quotes/${v.id}`).set('Cookie', c.quoter).expect(200);
    expect(after.body).toMatchObject({ rowVersion: 2, targetMarginRate: '0.183495' });
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ targetPricePerParticipant: '5150', targetMarginRate: '0.2', rowVersion: 2 })
      .expect(400);
    const fx = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({
        lines: [{ category: 'PER_GROUP', description: 'Bus', quantity: '1', unitCost: '1', currency: 'MXN' }],
        targetPricePerParticipant: '100',
        rowVersion: 2,
      })
      .expect(400);
    expect(fx.body.code).toBe('FX_REQUIRED');
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
    expect(original.body.totals.pricePerParticipant).toBe('5129.00');

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

describe('authorization (US-071..076)', () => {
  const delivery = {
    recipients: 'direccion@colegio.example',
    channel: 'EMAIL',
    sentOn: '2026-10-22',
  };
  const act = (cookie: string, id: string, action: string, body: object) =>
    api().post(`/api/v1/quotes/${id}/${action}`).set('Cookie', cookie).send(body);

  async function readyVersion() {
    const v = (await newScenario(c.quoter).expect(201)).body.latest;
    const res = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ ...option1, validUntil: '2026-12-31', rowVersion: 1 })
      .expect(200);
    return res.body as { id: string; rowVersion: number };
  }

  it('refuses incomplete versions', async () => {
    const v = (await newScenario(c.quoter).expect(201)).body.latest;
    const res = await act(c.quoter, v.id, 'submit', { rowVersion: 1 }).expect(400);
    expect(res.body.message).toContain('conceptos');
    expect(res.body.message).toContain('vigencia');
  });

  it('quoter submits, approver authorizes, quoter sends; request becomes SENT', async () => {
    const v = await readyVersion();
    await act(c.quoter, v.id, 'send', { ...delivery, rowVersion: v.rowVersion }).expect(403); // not authorized yet
    const s = await act(c.quoter, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201);
    expect(s.body.status).toBe('IN_REVIEW');
    // No edits while in review.
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ rowVersion: s.body.rowVersion })
      .expect(403);
    await act(c.quoter, v.id, 'approve', { rowVersion: s.body.rowVersion }).expect(403); // own work
    await act(c.adminA, v.id, 'approve', { rowVersion: s.body.rowVersion }).expect(403); // no privilege
    const a = await act(c.approver, v.id, 'approve', { rowVersion: s.body.rowVersion, comment: 'OK' }).expect(
      201,
    );
    expect(a.body.status).toBe('APPROVED');
    expect(a.body.reviews).toEqual([expect.objectContaining({ decision: 'APPROVED', comment: 'OK' })]);
    const sent = await act(c.quoter, v.id, 'send', { ...delivery, rowVersion: a.body.rowVersion }).expect(
      201,
    );
    expect(sent.body.status).toBe('SENT');
    expect(sent.body.deliveries).toEqual([
      expect.objectContaining({
        channel: 'EMAIL',
        recipients: 'direccion@colegio.example',
        sentOn: '2026-10-22',
      }),
    ]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: v.id, action: 'quote.sent' } });
    expect(JSON.stringify(log.diff)).not.toContain('colegio'); // contact data stays out of the log

    const xlsx = await api()
      .get(`/api/v1/quotes/${v.id}/export.xlsx`)
      .set('Cookie', c.approver)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toMatch(/filename="?EE-\d{4}-\w{6}-Opcion_1-v1\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as ExcelJS.Buffer);
    const values = (name: string) =>
      wb
        .getWorksheet(name)!
        .getSheetValues()
        .map((r) => (Array.isArray(r) ? r.slice(1) : []));
    // EE sheet layout: label/amount pairs in columns A–B (students) and D–E (chaperones).
    const ee = new Map(
      values('Cotización').flatMap((r) => [
        [r[0], r[1]],
        [r[3], r[4]],
      ]),
    );
    expect(ee.get('SubTotal 1')).toBe(4020);
    expect(ee.get('Gastos del líder (total chaperones ÷ estudiantes)')).toBe(185);
    expect(ee.get('SubTotal 2')).toBe(4205);
    expect(ee.get('% Comisión (sobre el precio final)')).toBe(0.18);
    expect(ee.get('PRECIO FINAL (EUR)')).toBe(5129);
    expect(ee.get('Total del grupo')).toBe(51290);
    expect(ee.get('Viáticos 16 días')).toBe(1600);
    expect(ee.get('SubTotal chaperones')).toBe(1700);
    expect(ee.get('Total chaperones')).toBe(1850);
    const lines = values('Conceptos');
    expect(lines).toContainEqual(['Por estudiante', 'Precio neto', 1, 3900, 'EUR', 3900, 'No', '', '']);
    expect(lines).toContainEqual(['Por chaperón EE', 'Viáticos 16 días', 16, 50, 'EUR', 1600, 'No', '', '']);
    expect(values('Plan de pagos')).toContainEqual(['Sin plan de pagos']);
    await api().get(`/api/v1/quotes/${v.id}/export.xlsx`).set('Cookie', c.advisor).expect(404);
    expect((await prisma.travelRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('SENT');
    await expect(prisma.quoteReview.deleteMany({ where: { versionId: v.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('returns with a mandatory reason and the quoter can fix and resubmit', async () => {
    await prisma.travelRequest.update({ where: { id: requestId }, data: { status: 'QUOTING' } });
    const v = await readyVersion();
    const s = await act(c.quoter, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201);
    await act(c.approver, v.id, 'return', { rowVersion: s.body.rowVersion }).expect(400);
    const r = await act(c.approver, v.id, 'return', {
      rowVersion: s.body.rowVersion,
      comment: 'Revisa el margen',
    }).expect(201);
    expect(r.body.status).toBe('RETURNED');
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ targetMarginRate: '0.2', rowVersion: r.body.rowVersion })
      .expect(200);
  });

  it('refuses to send when the approved calculation changed (US-075)', async () => {
    const v = await readyVersion();
    const s = await act(c.quoter, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201);
    const a = await act(c.approver, v.id, 'approve', { rowVersion: s.body.rowVersion }).expect(201);
    // Simulate a change behind the API's back.
    await prisma.quoteVersion.update({ where: { id: v.id }, data: { participants: 11 } });
    const res = await act(c.quoter, v.id, 'send', { ...delivery, rowVersion: a.body.rowVersion }).expect(409);
    expect(res.body.code).toBe('APPROVAL_STALE');
  });

  it('advisors read the shareable proposal without costs, flagged until authorized', async () => {
    const ready = await readyVersion();
    const comidas = {
      category: 'PER_PARTICIPANT',
      description: 'Comidas',
      quantity: '1',
      unitCost: '0',
      currency: 'EUR',
    };
    const v = (
      await api()
        .patch(`/api/v1/quotes/${ready.id}`)
        .set('Cookie', c.quoter)
        .send({ lines: [...option1.lines, comidas], rowVersion: ready.rowVersion })
        .expect(200)
    ).body;
    const p = await api().get(`/api/v1/quotes/${v.id}/proposal`).set('Cookie', c.advisor).expect(200);
    expect(p.body).toMatchObject({ authorized: false, pricePerParticipant: '5129.00', saleCurrency: 'EUR' });
    expect(p.body.includes).toContain('Precio neto');
    expect(p.body.includes).not.toContain('Comidas'); // base concept left at zero
    expect(JSON.stringify(p.body)).not.toMatch(/unitCost|margin|cost/i);
    const list = await api()
      .get(`/api/v1/requests/${requestId}/proposals`)
      .set('Cookie', c.advisor)
      .expect(200);
    expect(list.body.some((x: { versionId: string }) => x.versionId === v.id)).toBe(true);
    await api().get(`/api/v1/quotes/${v.id}/proposal`).set('Cookie', c.adminB).expect(404);
  });
});

describe('payment plan, free places and itinerary (Sprint B)', () => {
  const plan = {
    depositRate: '0.15',
    depositDueDate: '2026-11-15',
    installments: 6,
    frequency: 'MONTHLY',
    firstDueDate: '2027-01-31',
  };
  const content = {
    paymentPlan: plan,
    studentsPerFreePlace: 5,
    freePlaceBenefit: 'CHAPERONE',
    itinerary: [
      { day: 1, title: 'Llegada a Roma', details: 'Traslado al hotel' },
      { day: 2, title: 'Coliseo y Foro' },
    ],
    exclusions: ['Vuelo internacional', 'Gastos personales'],
  };

  it('computes the schedule from the rounded price and shows it all in the proposal', async () => {
    const v = (await newScenario(c.quoter).expect(201)).body.latest;
    const res = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ ...option1, ...content, rowVersion: 1 })
      .expect(200);
    expect(res.body.freePlaces).toBe(2); // 10 students, 1 per 5
    const pay = res.body.paymentSchedule as { number: number; dueDate: string; amount: string }[];
    expect(pay[0]).toEqual({ number: 0, dueDate: '2026-11-15', amount: '769.35' });
    expect(pay).toHaveLength(7);
    expect(pay.reduce((a, p) => a + Number(p.amount), 0).toFixed(2)).toBe('5129.00');
    const p = await api().get(`/api/v1/quotes/${v.id}/proposal`).set('Cookie', c.advisor).expect(200);
    expect(p.body).toMatchObject({
      paymentSchedule: pay,
      freePlaces: { count: 2, benefit: 'CHAPERONE' },
      itinerary: content.itinerary,
      exclusions: content.exclusions,
    });
    // The internal Excel carries the plan, free places, itinerary and exclusions in their own tabs.
    const file = await api()
      .get(`/api/v1/quotes/${v.id}/export.xlsx`)
      .set('Cookie', c.quoter)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (d: Buffer) => chunks.push(d));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as ExcelJS.Buffer);
    const tab = (name: string) =>
      wb
        .getWorksheet(name)!
        .getSheetValues()
        .map((r) => (Array.isArray(r) ? r.slice(1) : []));
    const payRows = tab('Plan de pagos');
    expect(payRows).toContainEqual(['Inscripción', '2026-11-15', 769.35]);
    expect(payRows).toContainEqual(['Pago 6 de 6', expect.any(String), expect.any(Number)]);
    expect(payRows).toContainEqual(['Lugares liberados', 2, '1 por cada 5 estudiantes, para chaperón']);
    const itRows = tab('Itinerario');
    expect(itRows).toContainEqual([1, 'Llegada a Roma', 'Traslado al hotel']);
    expect(itRows).toContainEqual(['', 'Gastos personales']);
    // Duplicates carry the proposal content.
    const dup = await api()
      .post(`/api/v1/scenarios/${v.scenarioId}/duplicate`)
      .set('Cookie', c.quoter)
      .send({ name: 'Con plan (copia)' })
      .expect(201);
    expect(dup.body.latest).toMatchObject({ paymentPlan: plan, exclusions: content.exclusions });
    // Clearing works.
    const cleared = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ paymentPlan: null, itinerary: null, studentsPerFreePlace: null, rowVersion: 2 })
      .expect(200);
    expect(cleared.body).toMatchObject({
      paymentPlan: null,
      paymentSchedule: null,
      itinerary: null,
      freePlaces: null,
    });
  });

  it('volume prices reach the proposal only when ticked, and quote events reach the timeline', async () => {
    const v = (await newScenario(c.quoter).expect(201)).body.latest;
    const saved = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ ...option1, rowVersion: 1 })
      .expect(200);
    const hidden = await api().get(`/api/v1/quotes/${v.id}/proposal`).set('Cookie', c.advisor).expect(200);
    expect(hidden.body.volumePrices).toBeNull();
    const shown = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ showVolumePrices: true, rowVersion: saved.body.rowVersion })
      .expect(200);
    expect(shown.body.showVolumePrices).toBe(true);
    const p = await api().get(`/api/v1/quotes/${v.id}/proposal`).set('Cookie', c.advisor).expect(200);
    expect(p.body.volumePrices).toEqual(shown.body.volumePrices);
    expect(JSON.stringify(p.body)).not.toMatch(/unitCost|margin|cost/i);
    // Quote edits show in the request timeline for those who see quotes, never for advisors.
    const tl = async (cookie: string) =>
      (await api().get(`/api/v1/requests/${requestId}/timeline`).set('Cookie', cookie).expect(200)).body
        .events as { id: string; action: string }[];
    expect((await tl(c.quoter)).some((e) => e.action === 'quote.version.updated' && e.id)).toBe(true);
    expect((await tl(c.advisor)).some((e) => e.action === 'quote.version.updated')).toBe(false);
  });

  it('a registration that no longer fits the price warns and blocks approval', async () => {
    const v = (await newScenario(c.quoter).expect(201)).body.latest;
    const res = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({
        ...option1,
        validUntil: '2026-12-31',
        paymentPlan: { ...plan, depositRate: undefined, depositAmount: '6000' },
        rowVersion: 1,
      })
      .expect(200);
    expect(res.body.warnings.map((w: { code: string }) => w.code)).toEqual(['PAYMENT_PLAN']);
    expect(res.body.paymentSchedule).toBeNull();
    const submit = await api()
      .post(`/api/v1/quotes/${v.id}/submit`)
      .set('Cookie', c.quoter)
      .send({ rowVersion: 2 })
      .expect(400);
    expect(submit.body.message).toContain('plan de pagos');
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ paymentPlan: { ...plan, installments: 20 }, rowVersion: 2 })
      .expect(400);
  });

  it('templates: saved from a version, used for a new scenario, scoped to the office', async () => {
    const v = (await newScenario(c.quoter).expect(201)).body.latest;
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({ ...option1, ...content, rowVersion: 1 })
      .expect(200);
    const t = await api()
      .post(`/api/v1/quotes/${v.id}/template`)
      .set('Cookie', c.quoter)
      .send({ name: 'Italia primavera' })
      .expect(201);
    await api()
      .post(`/api/v1/quotes/${v.id}/template`)
      .set('Cookie', c.approver)
      .send({ name: 'X' })
      .expect(403);
    await api()
      .post(`/api/v1/quotes/${v.id}/template`)
      .set('Cookie', c.adminB)
      .send({ name: 'X' })
      .expect(404);

    const list = await api()
      .get(`/api/v1/offices/${officeA}/quote-templates`)
      .set('Cookie', c.approver)
      .expect(200);
    expect(list.body.find((x: { id: string }) => x.id === t.body.id)).toMatchObject({ lineCount: 8 });
    await api().get(`/api/v1/offices/${officeA}/quote-templates`).set('Cookie', c.advisor).expect(404);
    await api().get(`/api/v1/offices/${officeA}/quote-templates`).set('Cookie', c.adminB).expect(404);
    const one = await api().get(`/api/v1/quote-templates/${t.body.id}`).set('Cookie', c.quoter).expect(200);
    expect(one.body).toMatchObject({ name: 'Italia primavera', targetMarginRate: '0.18' });
    expect(one.body.lines).toHaveLength(8);
    await api().get(`/api/v1/quote-templates/${t.body.id}`).set('Cookie', c.advisor).expect(404);
    await api().get(`/api/v1/quote-templates/${t.body.id}`).set('Cookie', c.adminB).expect(404);

    const s = await newScenario(c.quoter, {
      name: 'Desde plantilla',
      saleCurrency: 'EUR',
      templateId: t.body.id,
    }).expect(201);
    expect(s.body.latest).toMatchObject({
      targetMarginRate: '0.18',
      exclusions: content.exclusions,
      itinerary: content.itinerary,
      paymentPlan: null, // dates belong to the trip, not the template
    });
    expect(s.body.latest.totals.pricePerParticipant).toBe('5129.00');
    await newScenario(c.quoter, { name: 'X', saleCurrency: 'EUR', templateId: crypto.randomUUID() }).expect(
      404,
    );

    await api().delete(`/api/v1/quote-templates/${t.body.id}`).set('Cookie', c.quoter2).expect(403);
    await api().delete(`/api/v1/quote-templates/${t.body.id}`).set('Cookie', c.quoter).expect(204);
    await newScenario(c.quoter, { name: 'X', saleCurrency: 'EUR', templateId: t.body.id }).expect(404);
    const log = await prisma.auditLog.findMany({ where: { entityId: t.body.id } });
    expect(log.map((l) => l.action).sort()).toEqual(['quote_template.created', 'quote_template.retired']);
  });
});
