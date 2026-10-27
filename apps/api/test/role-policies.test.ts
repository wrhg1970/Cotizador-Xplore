import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'sysadmin' | 'advisor' | 'quoter' | 'approver' | 'adminA' | 'auditorB', string> = {} as never;
const ids: Record<string, string> = {};
let officeA: string;
let quoteId: string;
let requestId: string;

const api = () => ctx.http();
const policy = (cookie: string, role: string, body: object) =>
  api().put(`/api/v1/role-policies/${role}`).set('Cookie', cookie).send(body);
const DEFAULT = {
  allOffices: false,
  viewInternalCosts: true,
  exportInternalXlsx: true,
  approvalLimitMxn: null,
};

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
  await login('sysadmin', officeA, 'SYSTEM_ADMIN');
  await login('advisor', officeA, 'ADVISOR');
  await login('quoter', officeA, 'QUOTER');
  await login('approver', officeA, 'APPROVER');
  await login('adminA', officeA, 'OFFICE_ADMIN');
  await login('auditorB', officeB, 'AUDITOR');

  requestId = (
    await api()
      .post('/api/v1/requests')
      .set('Cookie', c.advisor)
      .send({
        officeId: officeA,
        groupName: 'Cancún 2027',
        city: 'Cancún',
        countryCode: 'MX',
        departureDate: '2027-03-19',
        returnDate: '2027-03-23',
        participants: 20,
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
  const s = (
    await api()
      .post(`/api/v1/requests/${requestId}/scenarios`)
      .set('Cookie', c.quoter)
      .send({ name: 'Opción 1', saleCurrency: 'MXN' })
      .expect(201)
  ).body;
  // 20 students × 30 000 MXN = 600 000 MXN group price at 0% margin.
  const ready = (
    await api()
      .patch(`/api/v1/quotes/${s.latest.id}`)
      .set('Cookie', c.quoter)
      .send({
        lines: [
          {
            category: 'PER_PARTICIPANT',
            description: 'Paquete',
            quantity: '1',
            unitCost: '30000',
            currency: 'MXN',
          },
        ],
        validUntil: '2026-12-31',
        rowVersion: s.latest.rowVersion,
      })
      .expect(200)
  ).body;
  quoteId = ready.id;
  await api()
    .post(`/api/v1/quotes/${quoteId}/submit`)
    .set('Cookie', c.quoter)
    .send({ rowVersion: ready.rowVersion })
    .expect(201);
});
afterAll(async () => {
  // Policies are global: put the seeded defaults back for the other test files.
  for (const role of ['QUOTER', 'APPROVER', 'OFFICE_ADMIN', 'AUDITOR'])
    await policy(c.sysadmin, role, DEFAULT).expect(200);
  await policy(c.sysadmin, 'ADVISOR', {
    ...DEFAULT,
    viewInternalCosts: false,
    exportInternalXlsx: false,
  }).expect(200);
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('role policies (Sprint C)', () => {
  it('only a system admin lists and edits them; SYSTEM_ADMIN itself is not editable', async () => {
    const list = await api().get('/api/v1/role-policies').set('Cookie', c.sysadmin).expect(200);
    expect(list.body.map((p: { role: string }) => p.role)).toEqual([
      'ADVISOR',
      'QUOTER',
      'APPROVER',
      'OFFICE_ADMIN',
      'AUDITOR',
    ]);
    expect(list.body.find((p: { role: string }) => p.role === 'ADVISOR').viewInternalCosts).toBe(false);
    await api().get('/api/v1/role-policies').set('Cookie', c.adminA).expect(403);
    await policy(c.adminA, 'QUOTER', DEFAULT).expect(403);
    await policy(c.sysadmin, 'SYSTEM_ADMIN', DEFAULT).expect(400);
    await policy(c.sysadmin, 'QUOTER', { ...DEFAULT, viewInternalCosts: false }).expect(400); // Excel needs costs
    await policy(c.sysadmin, 'QUOTER', { ...DEFAULT, approvalLimitMxn: '-1' }).expect(400);
    await policy(c.sysadmin, 'QUOTER', { ...DEFAULT, extra: true }).expect(400);
  });

  it('approval limit blocks approving above it and is audited', async () => {
    await policy(c.sysadmin, 'APPROVER', { ...DEFAULT, approvalLimitMxn: '500000' }).expect(200);
    const v = await prisma.quoteVersion.findUniqueOrThrow({ where: { id: quoteId } });
    const denied = await api()
      .post(`/api/v1/quotes/${quoteId}/approve`)
      .set('Cookie', c.approver)
      .send({ rowVersion: v.rowVersion })
      .expect(403);
    expect(denied.body.message).toContain('tope');
    const log = await prisma.auditLog.findFirst({
      where: { action: 'role_policy.updated', entityId: 'APPROVER' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.diff).toMatchObject({ after: { approvalLimitMxn: '500000.00' } });

    await policy(c.sysadmin, 'APPROVER', { ...DEFAULT, approvalLimitMxn: '600000' }).expect(200);
    await api()
      .post(`/api/v1/quotes/${quoteId}/approve`)
      .set('Cookie', c.approver)
      .send({ rowVersion: v.rowVersion })
      .expect(201);
  });

  it('internal costs and the internal Excel follow the policy', async () => {
    await api().get(`/api/v1/quotes/${quoteId}`).set('Cookie', c.advisor).expect(404);
    await policy(c.sysadmin, 'ADVISOR', { ...DEFAULT, exportInternalXlsx: false }).expect(200);
    await api().get(`/api/v1/quotes/${quoteId}`).set('Cookie', c.advisor).expect(200);
    await api().get(`/api/v1/quotes/${quoteId}/export.xlsx`).set('Cookie', c.advisor).expect(403);
    await api().get(`/api/v1/quotes/${quoteId}/export.xlsx`).set('Cookie', c.quoter).expect(200);

    await policy(c.sysadmin, 'QUOTER', { ...DEFAULT, exportInternalXlsx: false }).expect(200);
    await api().get(`/api/v1/quotes/${quoteId}/export.xlsx`).set('Cookie', c.quoter).expect(403);
  });

  it('a national auditor reads every office but cannot act as another role', async () => {
    await api().get(`/api/v1/requests/${requestId}`).set('Cookie', c.auditorB).expect(404);
    await policy(c.sysadmin, 'AUDITOR', { ...DEFAULT, allOffices: true }).expect(200);
    await api().get(`/api/v1/requests/${requestId}`).set('Cookie', c.auditorB).expect(200);
    await api().get(`/api/v1/quotes/${quoteId}`).set('Cookie', c.auditorB).expect(200);
    const me = await api().get('/api/v1/me').set('Cookie', c.auditorB).expect(200);
    expect(me.body.policies.AUDITOR.allOffices).toBe(true);
    await api()
      .post(`/api/v1/requests/${requestId}/cancel`)
      .set('Cookie', c.auditorB)
      .send({ reason: 'no', version: 3 })
      .expect(403);
  });
});
