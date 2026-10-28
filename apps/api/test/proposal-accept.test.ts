import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMailer, FakeOidc, loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const mailer = new FakeMailer();
const c: Record<string, string> = {};
const ids: Record<string, string> = {};
let officeId: string;

const api = () => ctx.http();
const act = (cookie: string, id: string, action: string, body: object = {}) =>
  api().post(`/api/v1/quotes/${id}/${action}`).set('Cookie', cookie).send(body);
const accept = (token: string, body: object) =>
  api()
    .post(`/api/v1/public/proposals/${token}/accept`)
    .set('X-Forwarded-For', '203.0.113.7, 10.0.0.1')
    .send(body);
const signer = { signerName: 'Mtra. Ana López', signerRole: 'Directora', accepted: true };

beforeAll(async () => {
  ctx = await makeApp(new FakeOidc(), undefined, mailer);
  officeId = (await makeOffice()).id;
  for (const [key, role] of [
    ['advisor', 'ADVISOR'],
    ['quoter', 'QUOTER'],
    ['approver', 'APPROVER'],
    ['admin', 'OFFICE_ADMIN'],
  ] as const) {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  }
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

/** A request with one approved version shared by link; `send` also records it as sent. */
async function sharedProposal(send: boolean) {
  const requestId = (
    await api()
      .post('/api/v1/requests')
      .set('Cookie', c.advisor!)
      .send({
        officeId,
        groupName: 'Firma colegio 2027',
        city: 'Madrid',
        countryCode: 'ES',
        departureDate: '2027-03-19',
        returnDate: '2027-03-25',
        participants: 10,
      })
      .expect(201)
  ).body.id;
  await api()
    .post(`/api/v1/requests/${requestId}/submit`)
    .set('Cookie', c.advisor!)
    .send({ version: 1 })
    .expect(201);
  await api()
    .post(`/api/v1/requests/${requestId}/assign`)
    .set('Cookie', c.admin!)
    .send({ assigneeId: ids.quoter, version: 2 })
    .expect(201);
  const v = (
    await api()
      .post(`/api/v1/requests/${requestId}/scenarios`)
      .set('Cookie', c.quoter!)
      .send({ name: 'Opción', saleCurrency: 'EUR' })
      .expect(201)
  ).body.latest;
  const draft = (
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter!)
      .send({
        targetMarginRate: '0.18',
        validUntil: '2026-12-31',
        rowVersion: 1,
        lines: [
          {
            category: 'PER_PARTICIPANT',
            description: 'Hotel',
            quantity: '1',
            unitCost: '1000',
            currency: 'EUR',
          },
        ],
      })
      .expect(200)
  ).body;
  const s = (await act(c.quoter!, v.id, 'submit', { rowVersion: draft.rowVersion }).expect(201)).body;
  const a = (await act(c.approver!, v.id, 'approve', { rowVersion: s.rowVersion }).expect(201)).body;
  if (send)
    await act(c.quoter!, v.id, 'send', {
      rowVersion: a.rowVersion,
      recipients: 'colegio',
      channel: 'EMAIL',
      sentOn: '2026-10-28',
    }).expect(201);
  const token = (await act(c.quoter!, v.id, 'shares', { days: 5 }).expect(201)).body.token as string;
  return { requestId, versionId: v.id as string, token };
}

describe('school accepts on the shared link', () => {
  it('records who, position, when and IP, marks the request won, audits and tells the team', async () => {
    const p = await sharedProposal(true);
    expect((await api().get(`/api/v1/public/proposals/${p.token}`).expect(200)).body).toMatchObject({
      canAccept: true,
      acceptance: null,
    });
    await accept(p.token, { ...signer, accepted: false }).expect(400);
    await accept(p.token, { signerName: '', signerRole: 'x', accepted: true }).expect(400);
    await accept(p.token, signer).expect(201);

    const r = await prisma.travelRequest.findUniqueOrThrow({ where: { id: p.requestId } });
    expect(r).toMatchObject({ status: 'WON', wonVersionId: p.versionId });
    const a = await prisma.proposalAcceptance.findUniqueOrThrow({ where: { versionId: p.versionId } });
    expect(a).toMatchObject({ signerName: 'Mtra. Ana López', signerRole: 'Directora', ip: '203.0.113.7' });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: p.requestId, action: 'request.won' },
    });
    expect(log.actorUserId).toBeNull();
    expect(JSON.stringify(log.diff)).not.toContain('Ana');
    await expect(prisma.proposalAcceptance.delete({ where: { id: a.id } })).rejects.toThrow(/append-only/);

    const after = (await api().get(`/api/v1/public/proposals/${p.token}`).expect(200)).body;
    expect(after).toMatchObject({ canAccept: false, acceptance: { signerName: 'Mtra. Ana López' } });
    await accept(p.token, signer).expect(409);
    await new Promise((done) => setTimeout(done, 50));
    expect(mailer.sent.some((m) => m.subject.startsWith('El colegio aceptó'))).toBe(true);
  });

  it('an authorized but unsent proposal, or a bad token, cannot be accepted', async () => {
    const p = await sharedProposal(false);
    expect((await api().get(`/api/v1/public/proposals/${p.token}`).expect(200)).body.canAccept).toBe(false);
    await accept(p.token, signer).expect(409);
    await accept('x'.repeat(43), signer).expect(404);
    expect((await prisma.travelRequest.findUniqueOrThrow({ where: { id: p.requestId } })).status).toBe(
      'QUOTING',
    );
  });
});
