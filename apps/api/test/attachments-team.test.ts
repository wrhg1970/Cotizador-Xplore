import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'advisor' | 'advisor2' | 'quoter' | 'auditor' | 'adminA' | 'adminB', string> = {} as never;
const ids: Record<string, string> = {};
let officeA: string;
let requestId: string;

const api = () => ctx.http();
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n').toString('base64');
const upload = (cookie: string, body: object) =>
  api().post(`/api/v1/requests/${requestId}/attachments`).set('Cookie', cookie).send(body);

beforeAll(async () => {
  ctx = await makeApp();
  officeA = (await makeOffice()).id;
  const officeB = (await makeOffice()).id;
  const login = async (
    key: keyof typeof c,
    officeId: string,
    role: 'ADVISOR' | 'QUOTER' | 'AUDITOR' | 'OFFICE_ADMIN',
  ) => {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  };
  await login('advisor', officeA, 'ADVISOR');
  await login('advisor2', officeA, 'ADVISOR');
  await login('quoter', officeA, 'QUOTER');
  await login('auditor', officeA, 'AUDITOR');
  await login('adminA', officeA, 'OFFICE_ADMIN');
  await login('adminB', officeB, 'OFFICE_ADMIN');
  requestId = (
    await api()
      .post('/api/v1/requests')
      .set('Cookie', c.advisor)
      .send({
        officeId: officeA,
        groupName: 'Adjuntos 2027',
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
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('request attachments', () => {
  it('uploads, lists, downloads as a forced download, and audits name only', async () => {
    const a = (await upload(c.advisor, { fileName: 'Carta del colegio.pdf', fileBase64: pdf }).expect(201))
      .body;
    expect(a).toMatchObject({ fileName: 'Carta del colegio.pdf', mimeType: 'application/pdf' });
    expect(a.content).toBeUndefined();
    const list = (
      await api().get(`/api/v1/requests/${requestId}/attachments`).set('Cookie', c.quoter).expect(200)
    ).body;
    expect(list.map((x: { id: string }) => x.id)).toContain(a.id);
    const file = await api()
      .get(`/api/v1/requests/${requestId}/attachments/${a.id}`)
      .set('Cookie', c.auditor)
      .expect(200);
    expect(file.headers['content-disposition']).toMatch(/^attachment; filename="?Carta_del_colegio.pdf"?$/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-type']).toContain('application/pdf');
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'request.attachment_added', entityId: requestId },
    });
    expect(log.diff).toMatchObject({ fileName: 'Carta del colegio.pdf', size: a.size });
    expect(JSON.stringify(log.diff)).not.toContain(pdf);
  });

  it('rejects disallowed or disguised files and oversize bodies', async () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0]).toString('base64');
    expect((await upload(c.advisor, { fileName: 'virus.pdf', fileBase64: exe }).expect(400)).body.code).toBe(
      'ATTACHMENT',
    );
    await upload(c.advisor, {
      fileName: 'page.html',
      fileBase64: Buffer.from('<script>').toString('base64'),
    }).expect(400);
    await upload(c.advisor, {
      fileName: 'x.pdf',
      fileBase64: Buffer.alloc(3 * 1024 * 1024 + 10).toString('base64'),
    }).expect(400);
    await upload(c.advisor, { fileName: 'x.pdf' }).expect(400);
  });

  it('enforces office and role on every action', async () => {
    await upload(c.auditor, { fileName: 'a.pdf', fileBase64: pdf }).expect(403); // no Editar
    await upload(c.adminB, { fileName: 'a.pdf', fileBase64: pdf }).expect(404); // other office
    const a = (await upload(c.quoter, { fileName: 'proveedor.pdf', fileBase64: pdf }).expect(201)).body;
    await api().get(`/api/v1/requests/${requestId}/attachments/${a.id}`).set('Cookie', c.adminB).expect(404);
    await api()
      .delete(`/api/v1/requests/${requestId}/attachments/${a.id}`)
      .set('Cookie', c.advisor2)
      .expect(403);
    await api()
      .delete(`/api/v1/requests/${requestId}/attachments/${a.id}`)
      .set('Cookie', c.adminA)
      .expect(200);
    expect(
      await prisma.auditLog.count({ where: { action: 'request.attachment_removed', entityId: requestId } }),
    ).toBe(1);
    await api().get(`/api/v1/requests/${requestId}/attachments`).expect(401);
  });
});

describe('request team', () => {
  const team = (cookie: string, body: object) =>
    api().put(`/api/v1/requests/${requestId}/team`).set('Cookie', cookie).send(body);

  it('the requester sets a commercial executive and support from the office, audited', async () => {
    const res = await team(c.advisor, {
      commercialExecutiveId: ids.advisor2,
      supportIds: [ids.quoter],
    }).expect(200);
    expect(res.body).toEqual([
      { kind: 'COMMERCIAL', user: expect.objectContaining({ id: ids.advisor2 }) },
      { kind: 'SUPPORT', user: expect.objectContaining({ id: ids.quoter }) },
    ]);
    expect(
      await prisma.auditLog.count({ where: { action: 'request.team_updated', entityId: requestId } }),
    ).toBe(1);
    const dash = (await api().get('/api/v1/dashboard').set('Cookie', c.advisor2).expect(200)).body;
    expect(dash.requests.find((r: { id: string }) => r.id === requestId).role).toBe('COMMERCIAL');
  });

  it('lists candidates from the office only', async () => {
    const list = (
      await api().get(`/api/v1/requests/${requestId}/team/candidates`).set('Cookie', c.advisor).expect(200)
    ).body;
    const got = list.map((u: { id: string }) => u.id);
    expect(got).toEqual(expect.arrayContaining([ids.advisor2, ids.quoter, ids.adminA]));
    expect(got).not.toContain(ids.adminB);
    expect(list[0].email).toBeUndefined();
    await api().get(`/api/v1/requests/${requestId}/team/candidates`).set('Cookie', c.adminB).expect(404);
  });

  it('refuses outsiders, duplicates and people from other offices', async () => {
    await team(c.quoter, { commercialExecutiveId: null, supportIds: [] }).expect(403);
    await team(c.adminB, { commercialExecutiveId: null, supportIds: [] }).expect(404);
    await team(c.adminA, { commercialExecutiveId: ids.adminB, supportIds: [] }).expect(400);
    await team(c.adminA, { commercialExecutiveId: ids.quoter, supportIds: [ids.quoter] }).expect(400);
    const cleared = await team(c.adminA, { commercialExecutiveId: null, supportIds: [] }).expect(200);
    expect(cleared.body).toEqual([]);
  });
});
