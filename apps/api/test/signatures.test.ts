import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

/**
 * Signatures (Will, 2026-11-23): one approver's signature, or the preparer's plus another approver's
 * when an approver prepared or corrected it; an approver may correct a version in review or approved.
 */
let ctx: Awaited<ReturnType<typeof makeApp>>;
let officeId: string;
const c: Record<string, string> = {};
const ids: Record<string, string> = {};
type V = { id: string; rowVersion: number; status: string; number: number; reviews: { comment: string }[] };

const api = () => ctx.http();
const act = (cookie: string, id: string, action: string, body: object) =>
  api().post(`/api/v1/quotes/${id}/${action}`).set('Cookie', cookie).send(body);
const lines = [
  {
    category: 'PER_PARTICIPANT',
    description: 'Precio neto',
    quantity: '1',
    unitCost: '2000',
    currency: 'MXN',
  },
];

/** A request in quotation assigned to `assignee`, with one complete scenario. */
async function ready(assignee: string): Promise<V> {
  const r = await api()
    .post('/api/v1/requests')
    .set('Cookie', c.admin!)
    .send({
      officeId,
      groupName: 'Firmas',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: '2027-03-19',
      returnDate: '2027-03-28',
      participants: 20,
      staff: 1,
    })
    .expect(201);
  await api()
    .post(`/api/v1/requests/${r.body.id}/submit`)
    .set('Cookie', c.admin!)
    .send({ version: 1 })
    .expect(201);
  await api()
    .post(`/api/v1/requests/${r.body.id}/assign`)
    .set('Cookie', c.admin!)
    .send({ assigneeId: ids[assignee], version: 2 })
    .expect(201);
  const s = await api()
    .post(`/api/v1/requests/${r.body.id}/scenarios`)
    .set('Cookie', c[assignee]!)
    .send({ name: 'Opción 1', saleCurrency: 'MXN' })
    .expect(201);
  return (
    await api()
      .patch(`/api/v1/quotes/${s.body.latest.id}`)
      .set('Cookie', c[assignee]!)
      .send({ lines, targetMarginRate: '0.18', validUntil: '2026-12-31', rowVersion: 1 })
      .expect(200)
  ).body;
}

beforeAll(async () => {
  ctx = await makeApp();
  officeId = (await makeOffice()).id;
  for (const [key, roles] of [
    ['quoter', ['QUOTER']],
    ['quoterApprover', ['QUOTER', 'APPROVER']],
    ['ana', ['APPROVER']],
    ['luis', ['APPROVER']],
    ['admin', ['OFFICE_ADMIN']],
  ] as const) {
    const u = await makeUser(roles.map((role) => ({ officeId, role })));
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  }
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('authorization signatures', () => {
  it('a quote prepared by someone without the role needs one approver', async () => {
    const v = await ready('quoter');
    const s = (await act(c.quoter!, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201)).body as V;
    expect(s.reviews).toEqual([]);
    const a = (await act(c.ana!, v.id, 'approve', { rowVersion: s.rowVersion }).expect(201)).body as V;
    expect(a.status).toBe('APPROVED');
  });

  it("an approver who prepared it signs when sending, and another approver's signature completes it", async () => {
    const v = await ready('quoterApprover');
    const s = (await act(c.quoterApprover!, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201))
      .body as V;
    expect(s.status).toBe('IN_REVIEW');
    expect(s.reviews).toEqual([expect.objectContaining({ comment: 'Firma de quien la preparó' })]);
    const again = await act(c.quoterApprover!, v.id, 'approve', { rowVersion: s.rowVersion }).expect(403);
    expect(again.body.message).toContain('Ya autorizaste');
    const a = (await act(c.ana!, v.id, 'approve', { rowVersion: s.rowVersion }).expect(201)).body as V;
    expect(a.status).toBe('APPROVED');
  });

  it('an approver corrects a version in review, signs it and a second approver completes it', async () => {
    const v = await ready('quoter');
    const s = (await act(c.quoter!, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201)).body as V;
    await act(c.quoter!, v.id, 'correct', { rowVersion: s.rowVersion }).expect(403); // not an approver
    const k = (await act(c.ana!, v.id, 'correct', { rowVersion: s.rowVersion }).expect(201)).body as V;
    expect(k.status).toBe('RETURNED');
    const patch = (cookie: string, rowVersion: number) =>
      api()
        .patch(`/api/v1/quotes/${v.id}`)
        .set('Cookie', cookie)
        .send({ targetMarginRate: '0.2', rowVersion });
    await patch(c.luis!, k.rowVersion).expect(403); // only the approver correcting it
    const e = (await patch(c.ana!, k.rowVersion).expect(200)).body as V;
    const sent = (await act(c.ana!, v.id, 'submit', { rowVersion: e.rowVersion }).expect(201)).body as V;
    expect(sent.status).toBe('IN_REVIEW');
    expect(sent.reviews.at(-1)).toMatchObject({ comment: 'Firma de quien la preparó' });
    await act(c.ana!, v.id, 'approve', { rowVersion: sent.rowVersion }).expect(403);
    const a = (await act(c.luis!, v.id, 'approve', { rowVersion: sent.rowVersion }).expect(201)).body as V;
    expect(a.status).toBe('APPROVED');
    expect(
      await prisma.auditLog.count({ where: { action: 'quote.correction_started', entityId: v.id } }),
    ).toBe(1);
  });

  it('the approver correcting it can hand it back to the quoter, who then edits it alone', async () => {
    const v = await ready('quoter');
    const s = (await act(c.quoter!, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201)).body as V;
    const k = (await act(c.ana!, v.id, 'correct', { rowVersion: s.rowVersion }).expect(201)).body as V;
    const back = (
      await act(c.ana!, v.id, 'return', {
        rowVersion: k.rowVersion,
        comment: 'Ajusté hotel; revisa transporte',
      }).expect(201)
    ).body as V;
    expect(back.status).toBe('RETURNED');
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.ana!)
      .send({ targetMarginRate: '0.2', rowVersion: back.rowVersion })
      .expect(403);
    const s2 = (await act(c.quoter!, v.id, 'submit', { rowVersion: back.rowVersion }).expect(201)).body as V;
    // Ana corrected it, so her signature alone is not enough.
    const first = (await act(c.ana!, v.id, 'approve', { rowVersion: s2.rowVersion }).expect(201)).body as V;
    expect(first.status).toBe('IN_REVIEW');
    expect(
      (await act(c.luis!, v.id, 'approve', { rowVersion: first.rowVersion }).expect(201)).body.status,
    ).toBe('APPROVED');
  });

  it('correcting an approved version freezes it and opens a new version for the approver', async () => {
    const v = await ready('quoter');
    const s = (await act(c.quoter!, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201)).body as V;
    const a = (await act(c.ana!, v.id, 'approve', { rowVersion: s.rowVersion }).expect(201)).body as V;
    await act(c.quoter!, v.id, 'correct', { rowVersion: a.rowVersion }).expect(403);
    const next = (await act(c.luis!, v.id, 'correct', { rowVersion: a.rowVersion }).expect(201)).body as V;
    expect(next).toMatchObject({ number: 2, status: 'DRAFT' });
    expect((await prisma.quoteVersion.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('SUPERSEDED');
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter!)
      .send({ targetMarginRate: '0.2', rowVersion: a.rowVersion + 1 })
      .expect(403); // the old one is frozen
    const e = (
      await api()
        .patch(`/api/v1/quotes/${next.id}`)
        .set('Cookie', c.luis!)
        .send({ targetMarginRate: '0.2', rowVersion: next.rowVersion })
        .expect(200)
    ).body as V;
    const sent = (await act(c.luis!, next.id, 'submit', { rowVersion: e.rowVersion }).expect(201)).body as V;
    const done = (await act(c.ana!, next.id, 'approve', { rowVersion: sent.rowVersion }).expect(201))
      .body as V;
    expect(done.status).toBe('APPROVED');
  });

  it('the approvals tray shows signatures needed and hides what the user already signed', async () => {
    const v = await ready('quoterApprover');
    await act(c.quoterApprover!, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201);
    const row = async (cookie: string) =>
      (
        (await api().get('/api/v1/reports/versions?status=APPROVAL').set('Cookie', cookie).expect(200))
          .body as {
          id: string;
          signatures: number;
          signaturesNeeded: number;
          canApprove: boolean;
        }[]
      ).find((x) => x.id === v.id);
    expect(await row(c.ana!)).toMatchObject({ signatures: 1, signaturesNeeded: 2, canApprove: true });
    expect(await row(c.quoterApprover!)).toMatchObject({ canApprove: false });
  });
});
