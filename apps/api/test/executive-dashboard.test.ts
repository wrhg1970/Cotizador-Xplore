import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'adminA' | 'auditorA' | 'advisorA' | 'adminB' | 'sysadmin', string> = {} as never;
let officeA: string;
let officeB: string;
let advisorId: string;

type Bucket = {
  requests: number;
  open: number;
  won: number;
  lost: number;
  wonAmount: Record<string, string>;
  conversion: number | null;
};
type Executive = {
  totals: Bucket;
  funnel: { stage: number; count: number }[];
  byOffice: (Bucket & { id: string })[];
  monthly: (Bucket & { month: string })[];
  upcoming: { folio: string }[];
};
const executive = (cookie: string, query = '', status = 200) =>
  ctx.http().get(`/api/v1/dashboard/executive${query}`).set('Cookie', cookie).expect(status);

/** A request in the given state; won ones get a sent version priced at 2 000 EUR per student. */
async function seedRequest(officeId: string, status: 'SUBMITTED' | 'WON' | 'LOST', departure = '2027-03-19') {
  const r = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${uniq().toUpperCase().slice(0, 6)}`,
      officeId,
      requesterId: advisorId,
      status: status === 'SUBMITTED' ? 'SUBMITTED' : 'SENT',
      groupName: 'Ejecutivo',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date(departure),
      returnDate: new Date('2027-03-25'),
      participants: 10,
    },
  });
  if (status === 'SUBMITTED') return r;
  const scenario = await prisma.quoteScenario.create({
    data: { requestId: r.id, name: 'Opción 1', createdById: advisorId },
  });
  const v = await prisma.quoteVersion.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      status: 'SENT',
      saleCurrency: 'EUR',
      participants: 10,
      chaperones: 0,
      staff: 0,
      createdById: advisorId,
      lines: {
        create: [
          {
            position: 0,
            category: 'PER_PARTICIPANT',
            description: 'Paquete',
            quantity: 1,
            unitCost: 2000,
            currency: 'EUR',
          },
        ],
      },
    },
  });
  return prisma.travelRequest.update({
    where: { id: r.id },
    data:
      status === 'WON'
        ? { status: 'WON', wonVersionId: v.id, closedAt: new Date() }
        : { status: 'LOST', lostReason: 'Precio', closedAt: new Date() },
  });
}

beforeAll(async () => {
  ctx = await makeApp();
  officeA = (await makeOffice()).id;
  officeB = (await makeOffice()).id;
  const login = async (
    key: keyof typeof c,
    officeId: string,
    role: 'ADVISOR' | 'AUDITOR' | 'OFFICE_ADMIN' | 'SYSTEM_ADMIN',
  ) => {
    const u = await makeUser([{ officeId, role }]);
    if (key === 'advisorA') advisorId = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  };
  await login('advisorA', officeA, 'ADVISOR');
  await login('adminA', officeA, 'OFFICE_ADMIN');
  await login('auditorA', officeA, 'AUDITOR');
  await login('adminB', officeB, 'OFFICE_ADMIN');
  await login('sysadmin', officeB, 'SYSTEM_ADMIN');
  await seedRequest(officeA, 'SUBMITTED');
  await seedRequest(officeA, 'WON', new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10));
  await seedRequest(officeA, 'WON');
  await seedRequest(officeA, 'LOST');
  await seedRequest(officeB, 'WON');
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('executive dashboard', () => {
  it('sums the office cohort: funnel, conversion and won amount per currency', async () => {
    const body = (await executive(c.adminA)).body as Executive;
    expect(body.totals).toMatchObject({ requests: 4, open: 1, won: 2, lost: 1, conversion: 66.7 });
    // 2 trips × 10 students × 2 000 EUR at 0% commission.
    expect(body.totals.wonAmount).toEqual({ EUR: '40000.00' });
    expect(body.funnel).toEqual([
      { stage: 1, count: 1 },
      { stage: 2, count: 0 },
      { stage: 3, count: 0 },
      { stage: 4, count: 0 },
    ]);
    expect(body.byOffice.map((o) => o.id)).toEqual([officeA]);
    expect(body.monthly).toHaveLength(1);
    expect(body.upcoming).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/unitCost|margin/i);
  });

  it('auditors read it too; a system admin filters any office', async () => {
    expect(((await executive(c.auditorA)).body as Executive).totals.requests).toBe(4);
    const b = (await executive(c.sysadmin, `?officeId=${officeB}`)).body as Executive;
    expect(b.byOffice.map((o) => o.id)).toEqual([officeB]);
    expect(b.totals.won).toBe(1);
  });

  it('annual goals: system admins set them; each office sees its MXN won against its goal', async () => {
    const year = new Date().getUTCFullYear();
    const goals = { [officeA]: '500000', [officeB]: '1000000' };
    await ctx.http().put(`/api/v1/settings/goals/${year}`).set('Cookie', c.adminA).send(goals).expect(403);
    await ctx
      .http()
      .put(`/api/v1/settings/goals/${year}`)
      .set('Cookie', c.sysadmin)
      .send({ x: '1' })
      .expect(400);
    await ctx.http().put(`/api/v1/settings/goals/1999`).set('Cookie', c.sysadmin).send(goals).expect(400);
    await ctx.http().put(`/api/v1/settings/goals/${year}`).set('Cookie', c.sysadmin).send(goals).expect(200);
    expect((await ctx.http().get(`/api/v1/settings/goals/${year}`).set('Cookie', c.sysadmin)).body).toEqual(
      goals,
    );
    await ctx.http().get(`/api/v1/settings/goals/${year}`).set('Cookie', c.adminA).expect(403);
    // Office B's trip gets an MXN rate: 10 × 2 000 EUR × 20 = 400 000 MXN. Office A's have none.
    const b = await prisma.travelRequest.findFirstOrThrow({ where: { officeId: officeB, status: 'WON' } });
    await prisma.quoteVersion.update({ where: { id: b.wonVersionId! }, data: { mxnRate: 20 } });

    const forA = (await executive(c.adminA)).body.goals;
    expect(forA.offices).toEqual([
      expect.objectContaining({
        id: officeA,
        goalMxn: '500000.00',
        wonMxn: '0.00',
        progress: 0,
        withoutRate: 2,
      }),
    ]);
    const all = (await executive(c.sysadmin)).body.goals;
    expect(all.offices.find((o: { id: string }) => o.id === officeB)).toMatchObject({
      wonMxn: '400000.00',
      progress: 40,
      withoutRate: 0,
    });
  });

  it('the period filters by creation date', async () => {
    const past = (await executive(c.adminA, '?from=2020-01-01&to=2020-12-31')).body as Executive;
    expect(past.totals).toMatchObject({ requests: 0, conversion: null, wonAmount: {} });
  });

  it('refuses other roles, other offices and bad filters', async () => {
    await executive(c.advisorA, '', 403);
    await executive(c.adminB, `?officeId=${officeA}`, 403);
    await executive(c.adminA, '?from=2027-02-01&to=2027-01-01', 400);
    await executive(c.adminA, '?from=ayer', 400);
    await executive(c.adminA, '?extra=1', 400);
    await ctx.http().get('/api/v1/dashboard/executive').expect(401);
  });
});
