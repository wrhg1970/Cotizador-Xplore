import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentLinkBody, WeTravel } from '../src/integrations/wetravel.js';
import { WeTravelError } from '../src/integrations/wetravel.js';
import { loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

class FakeWeTravel implements WeTravel {
  bodies: PaymentLinkBody[] = [];
  fail = false;
  async createPaymentLink(body: PaymentLinkBody) {
    if (this.fail) throw new WeTravelError(500, 'WeTravel respondió 500 al crear la liga de pago');
    this.bodies.push(body);
    const uuid = `wt-${uniq()}`;
    return { uuid, checkoutUrl: `https://wetravel.example/checkout/${uuid}` };
  }
}

const wt = new FakeWeTravel();
let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'advisor' | 'quoter' | 'adminB', string> = {} as never;
const ids: Record<string, string> = {};
let officeA: string;

async function wonRequest(status: 'WON' | 'SENT' = 'WON') {
  const r = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${uniq().toUpperCase()}`,
      officeId: officeA,
      requesterId: ids.advisor!,
      assigneeId: ids.quoter!,
      status: 'SENT',
      groupName: 'Roma 2027',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 10,
    },
  });
  const scenario = await prisma.quoteScenario.create({
    data: { requestId: r.id, name: 'Opción 1', createdById: ids.quoter! },
  });
  const v = await prisma.quoteVersion.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      status: 'SENT',
      saleCurrency: 'USD',
      participants: 10,
      chaperones: 0,
      staff: 0,
      createdById: ids.quoter!,
      lines: {
        create: [
          {
            position: 1,
            category: 'PER_PARTICIPANT',
            description: 'Hotel',
            quantity: 1,
            unitCost: 1000,
            currency: 'USD',
          },
        ],
      },
    },
  });
  if (status === 'WON')
    await prisma.travelRequest.update({ where: { id: r.id }, data: { status: 'WON', wonVersionId: v.id } });
  return { id: r.id, folio: r.folio, version: v.id };
}

const link = (cookie: string, versionId: string) =>
  ctx.http().post(`/api/v1/quotes/${versionId}/wetravel`).set('Cookie', cookie);

beforeAll(async () => {
  ctx = await makeApp(undefined, undefined, undefined, wt);
  officeA = (await makeOffice()).id;
  const officeB = (await makeOffice()).id;
  const login = async (
    key: keyof typeof c,
    officeId: string,
    role: 'ADVISOR' | 'QUOTER' | 'OFFICE_ADMIN',
  ) => {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  };
  await login('advisor', officeA, 'ADVISOR');
  await login('quoter', officeA, 'QUOTER');
  await login('adminB', officeB, 'OFFICE_ADMIN');
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('WeTravel payment link', () => {
  it('publishes the winning proposal once, stores the link and audits it', async () => {
    const r = await wonRequest();
    const res = await link(c.quoter, r.version).expect(201);
    expect(res.body.wetravelUrl).toMatch(/^https:\/\/wetravel\.example\/checkout\//);
    expect(wt.bodies.at(-1)).toMatchObject({
      external_id: r.folio,
      start_date: '2027-03-19',
      end_date: '2027-03-25',
      currency: 'USD',
      participant_fees: 'none',
    });
    expect(wt.bodies.at(-1)!.package.price).toBeGreaterThan(0);

    const req = await ctx.http().get(`/api/v1/requests/${r.id}`).set('Cookie', c.quoter).expect(200);
    expect(req.body.wetravelUrl).toBe(res.body.wetravelUrl);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: r.id, action: 'request.wetravel_link' },
    });
    expect(log.actorUserId).toBe(ids.quoter);

    const calls = wt.bodies.length;
    await link(c.quoter, r.version).expect(409);
    expect(wt.bodies.length).toBe(calls);
  });

  it('refuses non-winning versions, advisors and other offices', async () => {
    const sent = await wonRequest('SENT');
    await link(c.quoter, sent.version).expect(403);
    const r = await wonRequest();
    await link(c.advisor, r.version).expect(404);
    await link(c.adminB, r.version).expect(404);
    await ctx.http().post(`/api/v1/quotes/${r.version}/wetravel`).expect(401);
  });

  it('a WeTravel outage is a 502 and nothing is stored', async () => {
    const r = await wonRequest();
    wt.fail = true;
    await link(c.quoter, r.version).expect(502);
    wt.fail = false;
    expect((await prisma.travelRequest.findUniqueOrThrow({ where: { id: r.id } })).wetravelUrl).toBeNull();
  });
});

describe('WeTravel not configured', () => {
  it('answers 503', async () => {
    const bare = await makeApp();
    const u = await makeUser([{ officeId: officeA, role: 'QUOTER' }]);
    const cookie = (await loginAs(bare, u.email)).cookie!;
    const r = await wonRequest();
    await prisma.travelRequest.update({ where: { id: r.id }, data: { assigneeId: u.id } });
    await bare.http().post(`/api/v1/quotes/${r.version}/wetravel`).set('Cookie', cookie).expect(503);
    await bare.app.close();
  });
});
