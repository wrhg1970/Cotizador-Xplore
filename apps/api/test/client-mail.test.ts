import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendPaymentReminders } from '../src/notify/payment-reminders.js';
import { BRAND_OMIT, clientMailBrand } from '../src/agency/brand.js';
import { proposalMail } from '../src/notify/client-mail.js';
import { FakeMailer, loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'advisor' | 'quoter' | 'approver' | 'adminA' | 'adminB', string> = {} as never;
const ids: Record<string, string> = {};
let requestId: string;
let officeAId: string;
const mailer = new FakeMailer();

const api = () => ctx.http();
const act = (cookie: string, id: string, action: string, body: object = {}) =>
  api().post(`/api/v1/quotes/${id}/${action}`).set('Cookie', cookie).send(body);

beforeAll(async () => {
  ctx = await makeApp(undefined, undefined, mailer);
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
  officeAId = officeA;
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

async function newRequest() {
  requestId = (
    await api()
      .post('/api/v1/requests')
      .set('Cookie', c.advisor)
      .send({
        officeId: officeAId,
        groupName: 'Correo colegio 2027',
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
}

async function draftVersion() {
  await newRequest();
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
        paymentPlan: { installments: 2, frequency: 'MONTHLY', firstDueDate: '2030-05-10' },
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

const send = (cookie: string, id: string, body: object) =>
  act(cookie, id, 'send', { channel: 'EMAIL', sentOn: '2026-11-01', ...body });
const rowVersion = async (id: string) =>
  (await prisma.quoteVersion.findUniqueOrThrow({ where: { id } })).rowVersion;

describe('emails to the school', () => {
  it('sends the branded proposal with a working school link and records the send', async () => {
    const id = await approvedVersion();
    mailer.sent = [];
    await send(c.quoter, id, {
      rowVersion: await rowVersion(id),
      recipients: 'direccion@colegio.example, papas@colegio.example',
      emailClient: true,
      message: 'Hola <b>equipo</b>, aquí va.',
    }).expect(201);
    const m = mailer.sent.find((x) => x.html)!;
    expect(m.to).toBe('direccion@colegio.example, papas@colegio.example');
    expect(m.subject).toContain('Correo colegio 2027');
    expect(m.html).toContain('Hola &lt;b&gt;equipo&lt;/b&gt;'); // the quoter's text is escaped
    expect(m.html).not.toMatch(/unitCost|margen|costo/i);
    const token = /\/p\/([A-Za-z0-9_-]{43})/.exec(m.text)![1]!;
    await api().get(`/api/v1/public/proposals/${token}`).expect(200);

    const v = await prisma.quoteVersion.findUniqueOrThrow({ where: { id }, include: { deliveries: true } });
    expect(v.status).toBe('SENT');
    expect(v.deliveries[0]?.notes).toContain('Enviada por correo desde el cotizador');
    const log = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'quote.emailed' } });
    expect(log?.diff).toMatchObject({ recipients: 2 });
    expect(JSON.stringify(log?.diff)).not.toContain('colegio.example');
  });

  it('refuses bad addresses and records nothing when SMTP fails', async () => {
    const id = await approvedVersion();
    await send(c.quoter, id, {
      rowVersion: await rowVersion(id),
      recipients: 'Juan Pérez',
      emailClient: true,
    }).expect(400);
    await send(c.quoter, id, {
      rowVersion: await rowVersion(id),
      recipients: 'a@colegio.example',
      channel: 'WHATSAPP',
      emailClient: true,
    }).expect(400);
    mailer.fail = true;
    await send(c.quoter, id, {
      rowVersion: await rowVersion(id),
      recipients: 'a@colegio.example',
      emailClient: true,
    }).expect(502);
    mailer.fail = false;
    const v = await prisma.quoteVersion.findUniqueOrThrow({
      where: { id },
      include: { deliveries: true, shares: true },
    });
    expect(v).toMatchObject({ status: 'APPROVED', deliveries: [], shares: [] });
  });

  it('reminds the school of each payment once, and on demand', async () => {
    const id = await approvedVersion();
    await send(c.quoter, id, {
      rowVersion: await rowVersion(id),
      recipients: 'pagos@colegio.example',
      emailClient: true,
    }).expect(201);
    await api()
      .post(`/api/v1/requests/${requestId}/outcome`)
      .set('Cookie', c.quoter)
      .send({
        outcome: 'WON',
        versionId: id,
        version: (await prisma.travelRequest.findUniqueOrThrow({ where: { id: requestId } })).version,
      })
      .expect(201);

    await new Promise((r) => setTimeout(r, 50)); // let the fire-and-forget team notices land
    mailer.sent = [];
    const now = new Date('2030-05-07T15:00:00Z'); // first payment due 2030-05-10, within 5 days
    expect(await sendPaymentReminders(prisma, mailer, 'https://app.example', now)).toMatchObject({ sent: 1 });
    expect(await sendPaymentReminders(prisma, mailer, 'https://app.example', now)).toMatchObject({ sent: 0 });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: 'pagos@colegio.example' });
    expect(mailer.sent[0]!.text).toContain('pago 1');
    expect(mailer.sent[0]!.text).toContain('2030-05-10');

    const manual = await api()
      .post(`/api/v1/requests/${requestId}/payment-reminder`)
      .set('Cookie', c.quoter)
      .expect(201);
    expect(manual.body).toMatchObject({ number: 1, dueDate: '2030-05-10', recipients: 1 });
    await api().post(`/api/v1/requests/${requestId}/payment-reminder`).set('Cookie', c.approver).expect(403);
    await api().post(`/api/v1/requests/${requestId}/payment-reminder`).set('Cookie', c.adminB).expect(404);
  });
});

describe('school emails carry the agency brand', () => {
  it("uses the agency's name, colors, logo, sender and domain instead of EE's", async () => {
    const agency = await prisma.agency.create({
      data: {
        code: `AG-${crypto.randomUUID().slice(0, 8)}`.toUpperCase(),
        name: 'Viajes Norte',
        brandName: 'Norte <Tours>',
        primaryColor: '#112233',
        accentColor: '#445566',
        mailFromName: 'Norte Tours',
        customDomain: `cotiza-${crypto.randomUUID().slice(0, 8)}.example`,
      },
      omit: BRAND_OMIT,
    });
    const brand = clientMailBrand(agency, 'https://app.example');
    const m = proposalMail({
      to: ['a@b.example'],
      folio: 'F',
      groupName: 'G',
      url: 'u',
      brand,
      sender: 'Ana',
    });
    expect(m.fromName).toBe('Norte Tours');
    expect(m.html).toContain('#112233');
    expect(m.html).toContain('#445566');
    expect(m.html).toContain('Norte &lt;Tours&gt;');
    expect(m.html).not.toContain('Xplore');
    expect(m.html).not.toContain('<img'); // no logo uploaded, and EE's is not borrowed
    expect(m.text).toContain('Ana, Norte <Tours>.');
    expect(brand.origin).toBe(`https://${agency.customDomain}`);
  });
});
