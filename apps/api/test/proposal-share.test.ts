import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientProposal, full } from '../src/quotes/quotes.controller.js';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'advisor' | 'quoter' | 'approver' | 'adminA' | 'adminB', string> = {} as never;
const ids: Record<string, string> = {};
let requestId: string;

const api = () => ctx.http();
const act = (cookie: string, id: string, action: string, body: object = {}) =>
  api().post(`/api/v1/quotes/${id}/${action}`).set('Cookie', cookie).send(body);
const share = (cookie: string, id: string, body: object = {}) => act(cookie, id, 'shares', body);
const open = (token: string) => api().get(`/api/v1/public/proposals/${token}`);

beforeAll(async () => {
  ctx = await makeApp();
  const officeA = (await makeOffice()).id;
  const officeB = (await makeOffice()).id;
  const login = async (
    key: keyof typeof c,
    officeId: string,
    role: 'ADVISOR' | 'QUOTER' | 'APPROVER' | 'OFFICE_ADMIN',
  ) => {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  };
  await login('advisor', officeA, 'ADVISOR');
  await login('quoter', officeA, 'QUOTER');
  await login('approver', officeA, 'APPROVER');
  await login('adminA', officeA, 'OFFICE_ADMIN');
  await login('adminB', officeB, 'OFFICE_ADMIN');
  requestId = (
    await api()
      .post('/api/v1/requests')
      .set('Cookie', c.advisor)
      .send({
        officeId: officeA,
        groupName: 'Liga colegio 2027',
        city: 'Roma',
        countryCode: 'IT',
        departureDate: '2027-03-19',
        returnDate: '2027-03-25',
        participants: 10,
      })
      .expect(201)
  ).body.id;
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

async function draftVersion() {
  const v = (
    await api()
      .post(`/api/v1/requests/${requestId}/scenarios`)
      .set('Cookie', c.quoter)
      .send({ name: 'Opción', saleCurrency: 'EUR' })
      .expect(201)
  ).body.latest;
  return (
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({
        targetMarginRate: '0.18',
        validUntil: '2026-12-31',
        rowVersion: 1,
        lines: [
          {
            category: 'PER_PARTICIPANT',
            description: 'Precio neto',
            quantity: '1',
            unitCost: '1000',
            currency: 'EUR',
          },
        ],
      })
      .expect(200)
  ).body as { id: string; rowVersion: number };
}

async function approvedVersion() {
  const v = await draftVersion();
  const s = (await act(c.quoter, v.id, 'submit', { rowVersion: v.rowVersion }).expect(201)).body;
  await act(c.approver, v.id, 'approve', { rowVersion: s.rowVersion }).expect(201);
  return v.id;
}

describe('school share link', () => {
  it('only an authorized version can be shared, only by the assignee or office admin', async () => {
    const draft = await draftVersion();
    await share(c.quoter, draft.id).expect(403);
    const id = await approvedVersion();
    await share(c.advisor, id).expect(403);
    await share(c.approver, id).expect(403);
    await share(c.adminB, id).expect(404); // other office
    await share(c.quoter, id, { days: 0 }).expect(400);
    await share(c.quoter, id, { days: 91 }).expect(400);
    await share(c.adminA, id, { days: 7 }).expect(201);
  });

  it('opens without a session, shows no costs or ids, counts views, and keeps the token out of the DB and log', async () => {
    const id = await approvedVersion();
    const s = (await share(c.quoter, id, { days: 10 }).expect(201)).body;
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const p = (await open(s.token).expect(200)).body;
    expect(p).toMatchObject({
      authorized: true,
      saleCurrency: 'EUR',
      request: { groupName: 'Liga colegio 2027' },
    });
    expect(p.expiresAt).toBe(s.expiresAt);
    const body = JSON.stringify(p);
    expect(body).not.toMatch(/unitCost|margin|cost/i);
    expect(body).not.toContain(id);
    expect(body).not.toContain(requestId);
    await open(s.token).expect(200);

    const list = (await api().get(`/api/v1/quotes/${id}/shares`).set('Cookie', c.advisor).expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ id: s.id, viewCount: 2, revokedAt: null })]);
    expect(JSON.stringify(list)).not.toMatch(/token/i);
    const row = await prisma.proposalShare.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.tokenHash).not.toContain(s.token);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'proposal.share_created', entityId: id },
    });
    expect(JSON.stringify(log)).not.toContain(s.token);
  });

  it('every failure is the same 404: malformed, unknown, expired, revoked', async () => {
    const id = await approvedVersion();
    const gone = async (token: string) => {
      const res = await open(token).expect(404);
      expect(res.body.message).toBe('Esta liga no existe o ya no está vigente');
    };
    await gone('corto');
    await gone('A'.repeat(43));
    const expired = (await share(c.quoter, id).expect(201)).body;
    await prisma.proposalShare.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await gone(expired.token);
    const revoked = (await share(c.quoter, id).expect(201)).body;
    await api().delete(`/api/v1/quotes/${id}/shares/${revoked.id}`).set('Cookie', c.advisor).expect(403);
    await api().delete(`/api/v1/quotes/${id}/shares/${revoked.id}`).set('Cookie', c.quoter).expect(200);
    await gone(revoked.token);
    expect(await prisma.auditLog.count({ where: { action: 'proposal.share_revoked', entityId: id } })).toBe(
      1,
    );
  });

  it('stops working when the version is no longer authorized or the request is lost', async () => {
    const id = await approvedVersion();
    const s = (await share(c.quoter, id).expect(201)).body;
    await prisma.quoteVersion.update({ where: { id }, data: { status: 'SUPERSEDED' } });
    await open(s.token).expect(404);
    await prisma.quoteVersion.update({ where: { id }, data: { status: 'APPROVED' } });
    await open(s.token).expect(200);
    await prisma.travelRequest.update({
      where: { id: requestId },
      data: { status: 'LOST', lostReason: 'prueba' },
    });
    await open(s.token).expect(404);
    await prisma.travelRequest.update({
      where: { id: requestId },
      data: { status: 'QUOTING', lostReason: null },
    });
  });
});

describe('proposal cover photo and payment link', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const upload = async (fileName: string, bytes: Buffer, req = requestId) =>
    (
      await api()
        .post(`/api/v1/requests/${req}/attachments`)
        .set('Cookie', c.quoter)
        .send({ fileName, fileBase64: bytes.toString('base64') })
        .expect(201)
    ).body.id as string;

  it('only an image of the same request can be the cover; it is served to the session and the link', async () => {
    const pdf = await upload('cotizacion.pdf', Buffer.from('%PDF-1.4 x'));
    const photo = await upload('roma.png', PNG);
    const v = await draftVersion();
    const patch = (coverAttachmentId: string | null, rowVersion: number) =>
      api().patch(`/api/v1/quotes/${v.id}`).set('Cookie', c.quoter).send({ coverAttachmentId, rowVersion });
    await patch(pdf, v.rowVersion).expect(400);
    const saved = (await patch(photo, v.rowVersion).expect(200)).body;
    expect(saved.coverAttachmentId).toBe(photo);

    const s = (await act(c.quoter, v.id, 'submit', { rowVersion: saved.rowVersion }).expect(201)).body;
    await act(c.approver, v.id, 'approve', { rowVersion: s.rowVersion }).expect(201);
    const p = (await api().get(`/api/v1/quotes/${v.id}/proposal`).set('Cookie', c.advisor).expect(200)).body;
    expect(p).toMatchObject({ hasCover: true, paymentUrl: null });
    const img = await api().get(`/api/v1/quotes/${v.id}/proposal/cover`).set('Cookie', c.advisor).expect(200);
    expect(img.headers['content-type']).toMatch(/^image\/png/);
    await api().get(`/api/v1/quotes/${v.id}/proposal/cover`).set('Cookie', c.adminB).expect(404);
    await api().get(`/api/v1/quotes/${v.id}/proposal/cover`).expect(401);

    const link = (await share(c.quoter, v.id, { days: 3 }).expect(201)).body;
    await api().get(`/api/v1/public/proposals/${link.token}/cover`).expect(200);
    await api()
      .get(`/api/v1/public/proposals/${'x'.repeat(43)}/cover`)
      .expect(404);

    // A photo in use can't be deleted out from under an approved proposal.
    await api()
      .delete(`/api/v1/requests/${requestId}/attachments/${photo}`)
      .set('Cookie', c.quoter)
      .expect(409);
  });

  it('the payment link shows only on the winning proposal', async () => {
    const id = await approvedVersion();
    const other = await approvedVersion();
    const r = await prisma.travelRequest.findUniqueOrThrow({ where: { id: requestId } });
    const won = {
      ...r,
      status: 'WON' as const,
      wonVersionId: id,
      wetravelUrl: 'https://pay.example/checkout',
    };
    const version = (vid: string) =>
      prisma.quoteVersion.findUniqueOrThrow({ where: { id: vid }, include: full });
    expect(clientProposal(await version(id), won).paymentUrl).toBe('https://pay.example/checkout');
    expect(clientProposal(await version(other), won).paymentUrl).toBeNull();
  });
});
