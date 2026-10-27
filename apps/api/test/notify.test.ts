import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeMailer, FakeOidc, loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

const mailer = new FakeMailer();
let ctx: Awaited<ReturnType<typeof makeApp>>;
const u: Record<
  'advisor' | 'quoter' | 'approver' | 'approver2' | 'disabled' | 'adminA',
  { id: string; email: string; cookie: string }
> = {} as never;
let officeA: string;

const api = () => ctx.http();
const to = (email: string) => mailer.sent.filter((m) => m.to === email);

beforeAll(async () => {
  ctx = await makeApp(new FakeOidc(), undefined, mailer);
  officeA = (await makeOffice()).id;
  const otherOffice = (await makeOffice()).id;
  const login = async (
    key: keyof typeof u,
    officeId: string,
    role: 'ADVISOR' | 'QUOTER' | 'APPROVER' | 'OFFICE_ADMIN',
  ) => {
    const user = await makeUser([{ officeId, role }]);
    u[key] = { id: user.id, email: user.email, cookie: (await loginAs(ctx, user.email)).cookie! };
  };
  await login('advisor', officeA, 'ADVISOR');
  await login('quoter', officeA, 'QUOTER');
  await login('approver', officeA, 'APPROVER');
  await login('approver2', otherOffice, 'APPROVER');
  await login('disabled', officeA, 'APPROVER');
  await login('adminA', officeA, 'OFFICE_ADMIN');
  await prisma.user.update({ where: { id: u.disabled.id }, data: { status: 'DISABLED' } });
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

async function quoteInReview() {
  const id = (
    await api()
      .post('/api/v1/requests')
      .set('Cookie', u.advisor.cookie)
      .send({
        officeId: officeA,
        groupName: 'Avisos Roma 2027',
        city: 'Roma',
        countryCode: 'IT',
        departureDate: '2027-03-19',
        returnDate: '2027-03-25',
        participants: 10,
      })
      .expect(201)
  ).body;
  await api()
    .post(`/api/v1/requests/${id.id}/submit`)
    .set('Cookie', u.advisor.cookie)
    .send({ version: 1 })
    .expect(201);
  await api()
    .post(`/api/v1/requests/${id.id}/assign`)
    .set('Cookie', u.adminA.cookie)
    .send({ assigneeId: u.quoter.id, version: 2 })
    .expect(201);
  const s = (
    await api()
      .post(`/api/v1/requests/${id.id}/scenarios`)
      .set('Cookie', u.quoter.cookie)
      .send({ name: 'Opción 1', saleCurrency: 'MXN' })
      .expect(201)
  ).body;
  const ready = (
    await api()
      .patch(`/api/v1/quotes/${s.latest.id}`)
      .set('Cookie', u.quoter.cookie)
      .send({
        lines: [
          {
            category: 'PER_PARTICIPANT',
            description: 'Hotel',
            quantity: '1',
            unitCost: '98765',
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
    .set('Cookie', u.quoter.cookie)
    .send({ rowVersion: ready.rowVersion })
    .expect(201);
  return { requestId: id.id as string, folio: id.folio as string, quoteId: ready.id as string };
}

const rowVersion = async (id: string) =>
  (await prisma.quoteVersion.findUniqueOrThrow({ where: { id } })).rowVersion;

describe('email notices', () => {
  it('tells each person their turn, with folio, group and link only', async () => {
    mailer.sent = [];
    const q = await quoteInReview();
    await vi.waitFor(() => expect(to(u.approver.email)).toHaveLength(1));

    const [assigned] = to(u.quoter.email);
    expect(assigned!.subject).toBe(`Te asignaron la solicitud ${q.folio}`);
    expect(assigned!.text).toContain(`http://localhost:3000/solicitudes/${q.requestId}`);
    expect(assigned!.text).toContain('Grupo: Avisos Roma 2027');

    const [review] = to(u.approver.email);
    expect(review!.subject).toBe(`Cotización por autorizar ${q.folio}`);
    expect(review!.text).toContain(`/cotizaciones/${q.quoteId}`);
    // Never the author, approvers of other offices, disabled users, or the advisor.
    expect(to(u.approver2.email)).toEqual([]);
    expect(to(u.disabled.email)).toEqual([]);
    expect(to(u.advisor.email)).toEqual([]);
    expect(to(u.adminA.email)).toEqual([]); // the admin assigned it: no notice to themselves

    await api()
      .post(`/api/v1/quotes/${q.quoteId}/return`)
      .set('Cookie', u.approver.cookie)
      .send({ rowVersion: await rowVersion(q.quoteId), comment: 'Sube el margen a 25%' })
      .expect(201);
    await vi.waitFor(() => expect(to(u.quoter.email)).toHaveLength(2));
    expect(to(u.quoter.email)[1]!.subject).toBe(`Te devolvieron la cotización ${q.folio}`);

    await api()
      .post(`/api/v1/quotes/${q.quoteId}/submit`)
      .set('Cookie', u.quoter.cookie)
      .send({ rowVersion: await rowVersion(q.quoteId) })
      .expect(201);
    await api()
      .post(`/api/v1/quotes/${q.quoteId}/approve`)
      .set('Cookie', u.approver.cookie)
      .send({ rowVersion: await rowVersion(q.quoteId) })
      .expect(201);
    await vi.waitFor(() => expect(to(u.quoter.email)).toHaveLength(3));
    expect(to(u.quoter.email)[2]!.subject).toBe(`Cotización autorizada ${q.folio}`);
    expect(to(u.approver.email)).toHaveLength(2); // second review request, nothing for approving

    // No money, margins or reviewer comments ever leave the app.
    for (const m of mailer.sent) expect(m.text).not.toMatch(/98765|98,765|margen|25%|MXN|\$/);
  });

  it('an SMTP outage never blocks the workflow', async () => {
    mailer.fail = true;
    try {
      const q = await quoteInReview();
      expect((await prisma.quoteVersion.findUniqueOrThrow({ where: { id: q.quoteId } })).status).toBe(
        'IN_REVIEW',
      );
    } finally {
      mailer.fail = false;
    }
  });
});
