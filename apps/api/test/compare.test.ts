import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<string, string> = {};
const ids: Record<string, string> = {};

beforeAll(async () => {
  ctx = await makeApp();
  const officeA = (await makeOffice()).id;
  const officeB = (await makeOffice()).id;
  for (const [key, officeId, role] of [
    ['quoter', officeA, 'QUOTER'],
    ['adminB', officeB, 'OFFICE_ADMIN'],
  ] as const) {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  }
  const r = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${uniq().toUpperCase()}`,
      officeId: officeA,
      requesterId: ids.quoter!,
      assigneeId: ids.quoter!,
      status: 'QUOTING',
      groupName: 'Comparar',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 20,
    },
  });
  const sc = await prisma.quoteScenario.create({
    data: { requestId: r.id, name: 'A', createdById: ids.quoter! },
  });
  const version = (number: number, participants: number, lines: [string, number][]) =>
    prisma.quoteVersion.create({
      data: {
        scenarioId: sc.id,
        number,
        status: number === 1 ? 'SENT' : 'DRAFT',
        saleCurrency: 'MXN',
        targetMarginRate: '0.1',
        participants,
        chaperones: 0,
        staff: 0,
        createdById: ids.quoter!,
        lines: {
          create: lines.map(([description, unitCost], position) => ({
            position,
            category: 'PER_PARTICIPANT' as const,
            description,
            quantity: 1,
            unitCost,
            currency: 'MXN',
          })),
        },
      },
    });
  ids.v1 = (
    await version(1, 20, [
      ['Hotel', 900],
      ['Seguro', 100],
    ])
  ).id;
  ids.v2 = (
    await version(2, 25, [
      ['Hotel', 950],
      ['Tour', 50],
    ])
  ).id;
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('compare with the previous version', () => {
  it('lists changed fields, totals and concepts', async () => {
    const res = (
      await ctx.http().get(`/api/v1/quotes/${ids.v2}/compare`).set('Cookie', c.quoter!).expect(200)
    ).body;
    expect(res.previous).toMatchObject({ id: ids.v1, number: 1 });
    expect(res.fields).toContainEqual({ field: 'participants', label: 'Estudiantes', from: 20, to: 25 });
    expect(res.fields.map((f: { field: string }) => f.field)).toContain('groupPrice');
    expect(res.lines).toEqual([
      {
        change: 'CHANGED',
        description: 'Hotel',
        category: 'PER_PARTICIPANT',
        from: '1 × 900 MXN',
        to: '1 × 950 MXN',
      },
      { change: 'ADDED', description: 'Tour', category: 'PER_PARTICIPANT', from: null, to: '1 × 50 MXN' },
      {
        change: 'REMOVED',
        description: 'Seguro',
        category: 'PER_PARTICIPANT',
        from: '1 × 100 MXN',
        to: null,
      },
    ]);
  });

  it('v1 has nothing to compare; other offices get 404', async () => {
    expect(
      (await ctx.http().get(`/api/v1/quotes/${ids.v1}/compare`).set('Cookie', c.quoter!).expect(200)).body,
    ).toEqual({
      previous: null,
      fields: [],
      lines: [],
    });
    await ctx.http().get(`/api/v1/quotes/${ids.v2}/compare`).set('Cookie', c.adminB!).expect(404);
  });
});
