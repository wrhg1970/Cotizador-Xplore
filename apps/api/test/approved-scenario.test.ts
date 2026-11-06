import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

/** "Aprobada" step of a request and the one-approved-scenario rule (Will, 2026-11-06). */
let ctx: Awaited<ReturnType<typeof makeApp>>;
let officeId: string;
let requestId: string;
const c: Record<'quoter' | 'approver' | 'admin', string> = {} as never;
const ids: Record<string, string> = {};

const api = () => ctx.http();
const act = (cookie: string, id: string, action: string, body: object) =>
  api().post(`/api/v1/quotes/${id}/${action}`).set('Cookie', cookie).send(body);
const lines = [
  {
    category: 'PER_PARTICIPANT',
    description: 'Precio neto',
    quantity: '1',
    unitCost: '2000',
    currency: 'EUR',
  },
];

async function ready(name: string) {
  const s = await api()
    .post(`/api/v1/requests/${requestId}/scenarios`)
    .set('Cookie', c.quoter)
    .send({ name, saleCurrency: 'EUR' })
    .expect(201);
  const v = await api()
    .patch(`/api/v1/quotes/${s.body.latest.id}`)
    .set('Cookie', c.quoter)
    .send({ lines, targetMarginRate: '0.18', validUntil: '2026-12-31', rowVersion: 1 })
    .expect(200);
  return v.body as { id: string; rowVersion: number };
}
const submit = async (v: { id: string; rowVersion: number }) =>
  (await act(c.quoter, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201)).body as {
    id: string;
    rowVersion: number;
  };
const stageInList = async (stage: string) =>
  (
    await api().get(`/api/v1/requests?stage=${stage}&officeId=${officeId}`).set('Cookie', c.admin).expect(200)
  ).body.items.map((r: { id: string }) => r.id);
const detailStage = async () =>
  (await api().get(`/api/v1/requests/${requestId}`).set('Cookie', c.admin).expect(200)).body.stage;

beforeAll(async () => {
  ctx = await makeApp();
  officeId = (await makeOffice()).id;
  for (const [key, role] of [
    ['quoter', 'QUOTER'],
    ['approver', 'APPROVER'],
    ['admin', 'OFFICE_ADMIN'],
  ] as const) {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  }
  const r = await api()
    .post('/api/v1/requests')
    .set('Cookie', c.admin)
    .send({
      officeId,
      groupName: 'Roma 2027',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: '2027-03-19',
      returnDate: '2027-03-28',
      participants: 20,
      staff: 1,
    })
    .expect(201);
  requestId = r.body.id;
  await api()
    .post(`/api/v1/requests/${requestId}/submit`)
    .set('Cookie', c.admin)
    .send({ version: 1 })
    .expect(201);
  await api()
    .post(`/api/v1/requests/${requestId}/assign`)
    .set('Cookie', c.admin)
    .send({ assigneeId: ids.quoter, version: 2 })
    .expect(201);
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('Aprobada step and one approved scenario per request', () => {
  let a: { id: string; rowVersion: number };
  let b: { id: string; rowVersion: number };

  it('moves from Por aprobar to Aprobada when a scenario is authorized', async () => {
    a = await submit(await ready('Opción A'));
    b = await submit(await ready('Opción B'));
    expect(await detailStage()).toBe(2);
    expect(await stageInList('APPROVAL')).toContain(requestId);
    expect(await stageInList('APPROVED')).not.toContain(requestId);

    a = (await act(c.approver, a.id, 'approve', { rowVersion: a.rowVersion }).expect(201)).body;
    expect(await detailStage()).toBe(3);
    expect(await stageInList('APPROVED')).toContain(requestId);
    expect(await stageInList('APPROVAL')).not.toContain(requestId);
    expect(await stageInList('QUOTING')).not.toContain(requestId);
    const all = await api().get(`/api/v1/requests?officeId=${officeId}`).set('Cookie', c.admin).expect(200);
    expect(all.body.stageCounts).toEqual({ QUOTING: 0, APPROVAL: 0, APPROVED: 1, SENT: 0, WON: 0 });
    const dash = await api().get('/api/v1/dashboard').set('Cookie', c.admin).expect(200);
    const office = dash.body.offices.find((o: { id: string }) => o.id === officeId);
    expect(office.byStatus).toEqual({ APPROVED: 1 });
  });

  it('refuses to authorize or submit another scenario while one is approved', async () => {
    const res = await act(c.approver, b.id, 'approve', { rowVersion: b.rowVersion }).expect(409);
    expect(res.body.code).toBe('SCENARIO_ALREADY_APPROVED');
    expect(res.body.message).toContain('Opción A');
    const third = await ready('Opción C');
    await act(c.quoter, third.id, 'submit', { rowVersion: third.rowVersion }).expect(409);
    // Nothing changed on the refused version.
    expect((await prisma.quoteVersion.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('IN_REVIEW');
  });

  it('revokes an approval: reason required, only approvers, audited; then another scenario can win', async () => {
    await act(c.approver, a.id, 'revoke', { rowVersion: a.rowVersion }).expect(400);
    await act(c.quoter, a.id, 'revoke', { rowVersion: a.rowVersion, comment: 'x' }).expect(403);
    await act(c.admin, a.id, 'revoke', { rowVersion: a.rowVersion, comment: 'x' }).expect(403);
    await act(c.approver, b.id, 'revoke', { rowVersion: b.rowVersion, comment: 'x' }).expect(403); // not approved
    const r = await act(c.approver, a.id, 'revoke', {
      rowVersion: a.rowVersion,
      comment: 'El colegio prefiere hotel 4*',
    }).expect(201);
    expect(r.body.status).toBe('RETURNED');
    expect(r.body.reviews.at(-1)).toMatchObject({
      decision: 'RETURNED',
      comment: 'Aprobación revocada: El colegio prefiere hotel 4*',
    });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: a.id, action: 'quote.approval_revoked' },
    });
    expect(log.diff).toMatchObject({ status: { from: 'APPROVED', to: 'RETURNED' } });
    expect(await detailStage()).toBe(2);

    b = (await act(c.approver, b.id, 'approve', { rowVersion: b.rowVersion }).expect(201)).body;
    expect(b).toMatchObject({ status: 'APPROVED' });
    expect(await detailStage()).toBe(3);
  });

  it('a sent scenario also blocks the others; sending moves the request to Enviada', async () => {
    const sent = await act(c.quoter, b.id, 'send', {
      recipients: 'direccion@colegio.example',
      channel: 'EMAIL',
      sentOn: '2026-11-06',
      rowVersion: b.rowVersion,
    }).expect(201);
    expect(sent.body.status).toBe('SENT');
    expect(await detailStage()).toBe(4);
    expect(await stageInList('SENT')).toContain(requestId);
    await act(c.approver, b.id, 'revoke', { rowVersion: sent.body.rowVersion, comment: 'x' }).expect(403);
  });
});
