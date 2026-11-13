import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_POLICIES } from '../src/auth/authz.js';
import { loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'adminA' | 'auditorA' | 'advisorA' | 'adminB' | 'sys', string> = {} as never;
let officeA: string;
let officeB: string;
let advisorId: string;
const supplier = `ILAC ${uniq()}`;
const airline = `Aerolínea ${uniq()}`;

type Row = {
  folio: string;
  status: string;
  officeId: string;
  departureDate: string;
  volumeMxn: string | null;
  commissionMxn?: string | null;
  suppliers?: { name: string; kind: string | null; costMxn: string }[];
};
const summary = (cookie: string, query = '', status = 200) =>
  ctx.http().get(`/api/v1/reports/summary${query}`).set('Cookie', cookie).expect(status);

/** A won trip of 10 students: 1 000 CAD course from a catalog supplier + 500 CAD per group by hand, 15 MXN/CAD. */
async function wonTrip(officeId: string, departure: string, flight?: object) {
  const r = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${uniq().toUpperCase().slice(0, 6)}`,
      officeId,
      requesterId: advisorId,
      status: 'SENT',
      groupName: 'Reportes',
      city: 'Toronto',
      countryCode: 'CA',
      departureDate: new Date(departure),
      returnDate: new Date(departure),
      participants: 10,
    },
  });
  const scenario = await prisma.quoteScenario.create({
    data: { requestId: r.id, name: 'Opción 1', createdById: advisorId },
  });
  const v = await prisma.quoteVersion.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      status: 'SENT',
      saleCurrency: 'CAD',
      mxnRate: 15,
      participants: 10,
      chaperones: 0,
      staff: 0,
      flight,
      createdById: advisorId,
      lines: {
        create: [
          {
            position: 0,
            category: 'PER_PARTICIPANT',
            description: 'Curso',
            quantity: 1,
            unitCost: 1000,
            currency: 'CAD',
            costSource: supplier,
          },
          {
            position: 1,
            category: 'PER_GROUP',
            description: 'Bus',
            quantity: 1,
            unitCost: 500,
            currency: 'CAD',
          },
        ],
      },
    },
  });
  return prisma.travelRequest.update({
    where: { id: r.id },
    data: { status: 'WON', wonVersionId: v.id, closedAt: new Date() },
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
  await login('sys', officeB, 'SYSTEM_ADMIN');
  const { agencyId } = await prisma.office.findUniqueOrThrow({ where: { id: officeA } });
  await prisma.supplier.create({ data: { agencyId, name: supplier, kind: 'Escuela' } });
  await wonTrip(officeA, '2031-03-10');
  // Avión of 100 CAD per ticket, apart from the course, typed by hand.
  await wonTrip(officeB, '2031-04-10', {
    netCost: '100',
    finalPrice: '120',
    currency: 'CAD',
    shareChaperones: false,
    shareStaff: false,
    addToCourse: false,
    supplier: airline,
  });
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('reports summary', () => {
  it('lists the office rows with MXN volume, commission and cost per supplier', async () => {
    const body = (await summary(c.adminA)).body as { period: { basis: string }; rows: Row[] };
    expect(body.period.basis).toBe('CREATED');
    expect(body.rows.map((r) => r.officeId)).toEqual([officeA]);
    // Price at 0% commission = cost: (10 × 1 000 + 500) CAD × 15.
    expect(body.rows[0]).toMatchObject({ status: 'WON', volumeMxn: '157500.00', commissionMxn: '0.00' });
    expect(body.rows[0]!.suppliers).toEqual([
      { name: supplier, kind: 'Escuela', costMxn: '150000.00' },
      { name: 'Sin proveedor', kind: null, costMxn: '7500.00' },
    ]);
  });

  it('filters by departure date when asked', async () => {
    const dep = (await summary(c.sys, `?officeId=${officeB}&basis=DEPARTURE&from=2031-04-01&to=2031-04-30`))
      .body.rows as Row[];
    expect(dep.map((r) => r.officeId)).toEqual([officeB]);
    const created = (await summary(c.sys, `?officeId=${officeB}&from=2031-04-01&to=2031-04-30`)).body
      .rows as Row[];
    expect(created).toHaveLength(0);
  });

  it('puts the plane tickets under their supplier', async () => {
    const rows = (await summary(c.sys, `?officeId=${officeB}&basis=DEPARTURE&from=2031-04-01&to=2031-04-30`))
      .body.rows as Row[];
    expect(rows[0]!.suppliers).toContainEqual({ name: airline, kind: 'Aéreo', costMxn: '15000.00' });
  });

  it('hides commission and suppliers from roles that do not see costs', async () => {
    const sys = await makeUser([{ officeId: officeB, role: 'SYSTEM_ADMIN' }]);
    const sysCookie = (await loginAs(ctx, sys.email)).cookie!;
    const setAuditor = (viewInternalCosts: boolean) =>
      ctx
        .http()
        .put('/api/v1/role-policies/AUDITOR')
        .set('Cookie', sysCookie)
        .send({ ...DEFAULT_POLICIES.AUDITOR, viewInternalCosts, exportInternalXlsx: viewInternalCosts })
        .expect(200);
    await setAuditor(false);
    try {
      const rows = (await summary(c.auditorA)).body.rows as Row[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.volumeMxn).toBe('157500.00');
      expect(JSON.stringify(rows)).not.toMatch(/commission|suppliers|cost/i);
    } finally {
      await setAuditor(true);
    }
  });

  it('refuses other roles, other offices and bad filters', async () => {
    await summary(c.advisorA, '', 403);
    await summary(c.adminB, `?officeId=${officeA}`, 403);
    await summary(c.adminA, '?basis=SALIDA', 400);
    await summary(c.adminA, '?from=2027-02-01&to=2027-01-01', 400);
    await summary(c.adminA, '?extra=1', 400);
  });
});
