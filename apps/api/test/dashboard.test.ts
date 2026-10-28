import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'advisor' | 'quoter' | 'approver' | 'adminA' | 'adminB', string> = {} as never;
const ids: Record<string, string> = {};
let officeA: string;

const api = () => ctx.http();
const dashboard = async (cookie: string) =>
  (await api().get('/api/v1/dashboard').set('Cookie', cookie).expect(200)).body as {
    tasks: { kind: string; requestId: string; quoteId: string | null }[];
    offices: { id: string; byStatus: Record<string, number> }[];
    requests: { id: string; stage: number; role: string; scenarios: number; price: unknown }[];
  };
const card = async (cookie: string, requestId: string) =>
  (await dashboard(cookie)).requests.find((r) => r.id === requestId);
const kinds = async (cookie: string, requestId: string) =>
  (await dashboard(cookie)).tasks.filter((t) => t.requestId === requestId).map((t) => t.kind);

const newRequest = async (groupName: string) =>
  (
    await api()
      .post('/api/v1/requests')
      .set('Cookie', c.advisor)
      .send({
        officeId: officeA,
        groupName,
        city: 'Roma',
        countryCode: 'IT',
        departureDate: '2027-03-19',
        returnDate: '2027-03-25',
        participants: 10,
      })
      .expect(201)
  ).body.id as string;

beforeAll(async () => {
  ctx = await makeApp();
  officeA = (await makeOffice()).id;
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
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('dashboard "Mi trabajo" (Sprint C)', () => {
  it('follows a request through each step, showing it only to whoever has to act', async () => {
    const id = await newRequest('Roma 2027');
    expect(await kinds(c.advisor, id)).toEqual(['SUBMIT_REQUEST']);
    expect(await kinds(c.adminA, id)).toEqual([]); // drafts stay private
    expect(await card(c.advisor, id)).toMatchObject({ stage: 1, role: 'REQUESTER', price: null });
    expect(await card(c.adminA, id)).toBeUndefined();

    await api()
      .post(`/api/v1/requests/${id}/submit`)
      .set('Cookie', c.advisor)
      .send({ version: 1 })
      .expect(201);
    expect(await kinds(c.advisor, id)).toEqual([]);
    expect(await kinds(c.adminA, id)).toEqual(['ASSIGN']);
    expect(await kinds(c.adminB, id)).toEqual([]); // other office
    expect(await card(c.adminA, id)).toMatchObject({ stage: 1, role: 'SUPPORT' });
    expect(await card(c.adminB, id)).toBeUndefined();

    await api()
      .post(`/api/v1/requests/${id}/assign`)
      .set('Cookie', c.adminA)
      .send({ assigneeId: ids.quoter, version: 2 })
      .expect(201);
    expect(await kinds(c.quoter, id)).toEqual(['QUOTE']);
    expect(await kinds(c.adminA, id)).toEqual([]);

    const s = (
      await api()
        .post(`/api/v1/requests/${id}/scenarios`)
        .set('Cookie', c.quoter)
        .send({ name: 'Opción 1', saleCurrency: 'MXN' })
        .expect(201)
    ).body;
    const ready = (
      await api()
        .patch(`/api/v1/quotes/${s.latest.id}`)
        .set('Cookie', c.quoter)
        .send({
          lines: [
            {
              category: 'PER_PARTICIPANT',
              description: 'Hotel',
              quantity: '1',
              unitCost: '1000',
              currency: 'MXN',
            },
          ],
          validUntil: '2026-12-31',
          rowVersion: s.latest.rowVersion,
        })
        .expect(200)
    ).body;
    await api()
      .post(`/api/v1/quotes/${ready.id}/submit`)
      .set('Cookie', c.quoter)
      .send({ rowVersion: ready.rowVersion })
      .expect(201);
    expect(await kinds(c.quoter, id)).toEqual([]); // waiting on the approver now
    expect(await kinds(c.approver, id)).toEqual(['APPROVE']);
    expect(await kinds(c.adminA, id)).toEqual([]); // admins are not approvers
    expect(await card(c.quoter, id)).toMatchObject({ stage: 2, role: 'ASSIGNEE', scenarios: 1 });

    const inReview = await prisma.quoteVersion.findUniqueOrThrow({ where: { id: ready.id } });
    await api()
      .post(`/api/v1/quotes/${ready.id}/return`)
      .set('Cookie', c.approver)
      .send({ rowVersion: inReview.rowVersion, comment: 'Falta el seguro' })
      .expect(201);
    expect(await kinds(c.quoter, id)).toEqual(['FIX_QUOTE']);
    expect(await kinds(c.approver, id)).toEqual([]);

    const returned = await prisma.quoteVersion.findUniqueOrThrow({ where: { id: ready.id } });
    await api()
      .post(`/api/v1/quotes/${ready.id}/submit`)
      .set('Cookie', c.quoter)
      .send({ rowVersion: returned.rowVersion })
      .expect(201);
    const again = await prisma.quoteVersion.findUniqueOrThrow({ where: { id: ready.id } });
    await api()
      .post(`/api/v1/quotes/${ready.id}/approve`)
      .set('Cookie', c.approver)
      .send({ rowVersion: again.rowVersion })
      .expect(201);
    expect(await kinds(c.quoter, id)).toEqual(['SEND']);
    expect(await kinds(c.adminA, id)).toEqual(['SEND']);
    expect(await kinds(c.approver, id)).toEqual([]);
    // 10 students × 1 000 MXN at 0% commission: the client price, never the cost breakdown.
    expect(await card(c.adminA, id)).toMatchObject({
      stage: 3,
      price: { amount: '1000.00', currency: 'MXN' },
    });
  });

  it('an approver never gets their own quote to approve', async () => {
    const u = await makeUser([
      { officeId: officeA, role: 'QUOTER' },
      { officeId: officeA, role: 'APPROVER' },
    ]);
    const both = (await loginAs(ctx, u.email)).cookie!;
    const id = await newRequest('Madrid 2027');
    await api()
      .post(`/api/v1/requests/${id}/submit`)
      .set('Cookie', c.advisor)
      .send({ version: 1 })
      .expect(201);
    await api()
      .post(`/api/v1/requests/${id}/assign`)
      .set('Cookie', c.adminA)
      .send({ assigneeId: u.id, version: 2 })
      .expect(201);
    const s = (
      await api()
        .post(`/api/v1/requests/${id}/scenarios`)
        .set('Cookie', both)
        .send({ name: 'Opción 1', saleCurrency: 'MXN' })
        .expect(201)
    ).body;
    const ready = (
      await api()
        .patch(`/api/v1/quotes/${s.latest.id}`)
        .set('Cookie', both)
        .send({
          lines: [
            {
              category: 'PER_PARTICIPANT',
              description: 'Hotel',
              quantity: '1',
              unitCost: '1000',
              currency: 'MXN',
            },
          ],
          validUntil: '2026-12-31',
          rowVersion: s.latest.rowVersion,
        })
        .expect(200)
    ).body;
    await api()
      .post(`/api/v1/quotes/${ready.id}/submit`)
      .set('Cookie', both)
      .send({ rowVersion: ready.rowVersion })
      .expect(201);
    expect(await kinds(both, id)).toEqual([]);
    expect(await kinds(c.approver, id)).toEqual(['APPROVE']);
  });

  it('counts requests only in the offices the user belongs to, without other people’s drafts', async () => {
    const before = (await dashboard(c.adminA)).offices;
    expect(before.map((o) => o.id)).toEqual([officeA]);
    await newRequest('Borrador privado');
    const after = (await dashboard(c.adminA)).offices[0]!;
    expect(after.byStatus.DRAFT ?? 0).toBe(before[0]!.byStatus.DRAFT ?? 0);
    const advisor = (await dashboard(c.advisor)).offices[0]!;
    expect(advisor.byStatus.DRAFT).toBeGreaterThan(0);
    expect((await dashboard(c.adminB)).offices.every((o) => o.id !== officeA)).toBe(true);
  });

  it('requires a session', async () => {
    await api().get('/api/v1/dashboard').expect(401);
  });
});
