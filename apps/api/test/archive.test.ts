import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMailer, FakeOidc, loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<string, string> = {};
const ids: Record<string, string> = {};
let officeId: string;

const api = () => ctx.http();
const act = (cookie: string, id: string, action: string, body: object = {}) =>
  api().post(`/api/v1/quotes/${id}/${action}`).set('Cookie', cookie).send(body);
const signer = { signerName: 'Mtra. Ana López', signerRole: 'Directora', accepted: true };
const req = (cookie: string, id: string, action: string, body: object = {}) =>
  api().post(`/api/v1/requests/${id}/${action}`).set('Cookie', cookie).send(body);
const current = (id: string) => prisma.travelRequest.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  ctx = await makeApp(new FakeOidc(), undefined, new FakeMailer());
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

/** Sent, accepted online (WON) and with a file in the proposal's expediente: every table the purge must clear. */
async function wonRequest() {
  const p = await sharedProposal(true);
  await api().post(`/api/v1/public/proposals/${p.token}/accept`).send(signer).expect(201);
  await prisma.requestAttachment.create({
    data: {
      requestId: p.requestId,
      versionId: p.versionId,
      fileName: 'propuesta.pdf',
      mimeType: 'application/pdf',
      size: 4,
      content: Buffer.from('%PDF'),
      uploadedById: ids.quoter!,
    },
  });
  return p;
}

describe('archive and purge a request (expediente)', () => {
  it('archive hides it everywhere, freezes it and needs the Borrar permission', async () => {
    const p = await wonRequest();
    const r = await current(p.requestId);
    await req(c.quoter!, p.requestId, 'archive', { version: r.version }).expect(403);
    const archived = (await req(c.admin!, p.requestId, 'archive', { version: r.version }).expect(201)).body;
    expect(archived.archivedAt).toBeTruthy();
    await req(c.admin!, p.requestId, 'archive', { version: archived.version }).expect(409);

    const list = (q: string) =>
      api().get(`/api/v1/requests?officeId=${officeId}${q}`).set('Cookie', c.admin!).expect(200);
    expect((await list('')).body.items.map((i: { id: string }) => i.id)).not.toContain(p.requestId);
    expect((await list('&archived=true')).body.items.map((i: { id: string }) => i.id)).toEqual([p.requestId]);
    const sent = await api().get('/api/v1/reports/versions?status=SENT').set('Cookie', c.admin!).expect(200);
    expect(JSON.stringify(sent.body)).not.toContain(p.versionId);
    await api().get(`/api/v1/public/proposals/${p.token}`).expect(404);
    // Still readable, but read-only.
    await api().get(`/api/v1/requests/${p.requestId}`).set('Cookie', c.admin!).expect(200);
    await req(c.admin!, p.requestId, 'cancel', { reason: 'x', version: archived.version }).expect(403);

    const back = (await req(c.admin!, p.requestId, 'unarchive', { version: archived.version }).expect(201))
      .body;
    expect(back.archivedAt).toBeNull();
    await api().get(`/api/v1/public/proposals/${p.token}`).expect(200);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: p.requestId } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['request.archived', 'request.unarchived']));
  });

  it('purge only from the archive, with the folio, removes everything and leaves an audit entry', async () => {
    const p = await wonRequest();
    const r = await current(p.requestId);
    const purge = (cookie: string, folio: string) =>
      api().delete(`/api/v1/requests/${p.requestId}`).set('Cookie', cookie).send({ folio });
    await purge(c.admin!, r.folio).expect(403);
    await req(c.admin!, p.requestId, 'archive', { version: r.version }).expect(201);
    await purge(c.quoter!, r.folio).expect(403);
    await purge(c.admin!, 'OTRO-FOLIO').expect(400);
    await purge(c.admin!, r.folio.toLowerCase()).expect(200);

    expect(await prisma.travelRequest.findUnique({ where: { id: p.requestId } })).toBeNull();
    const byVersion = { where: { versionId: p.versionId } };
    expect(await prisma.quoteVersion.count({ where: { id: p.versionId } })).toBe(0);
    expect(await prisma.quoteReview.count(byVersion)).toBe(0);
    expect(await prisma.proposalAcceptance.count(byVersion)).toBe(0);
    expect(await prisma.proposalShare.count(byVersion)).toBe(0);
    expect(await prisma.proposalDelivery.count(byVersion)).toBe(0);
    expect(await prisma.requestAttachment.count({ where: { requestId: p.requestId } })).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: p.requestId, action: 'request.purged' },
    });
    expect(log).toMatchObject({ actorUserId: ids.admin, officeId });
    expect(log.diff).toMatchObject({ folio: r.folio, status: 'WON', versions: 1, files: 1 });
    await api().get(`/api/v1/requests/${p.requestId}`).set('Cookie', c.admin!).expect(404);
  });

  it('evidence tables stay append-only outside the purge', async () => {
    const p = await wonRequest();
    const review = await prisma.quoteReview.findFirstOrThrow({ where: { versionId: p.versionId } });
    await expect(prisma.quoteReview.delete({ where: { id: review.id } })).rejects.toThrow(/append-only/);
  });
});
