import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeAgency, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

/** Incluye / No incluye catalog (Will, 2026-11-13). Its own agency, so "Siempre marcado" touches no other test. */
let ctx: Awaited<ReturnType<typeof makeApp>>;
let sysAdmin: string;
let quoter: string;
let officeAdmin: string;
let requestId: string;

beforeAll(async () => {
  ctx = await makeApp();
  const agency = await makeAgency();
  const office = (await makeOffice(agency.id)).id;
  const login = async (role: 'SYSTEM_ADMIN' | 'OFFICE_ADMIN' | 'QUOTER') => {
    const u = await makeUser([{ officeId: office, role }], 'INVITED', agency.id);
    return { id: u.id, cookie: (await loginAs(ctx, u.email)).cookie! };
  };
  sysAdmin = (await login('SYSTEM_ADMIN')).cookie;
  officeAdmin = (await login('OFFICE_ADMIN')).cookie;
  const q = await login('QUOTER');
  quoter = q.cookie;
  requestId = (
    await prisma.travelRequest.create({
      data: {
        folio: `EE-2030-${uniq().toUpperCase().slice(0, 6)}`,
        officeId: office,
        requesterId: q.id,
        assigneeId: q.id,
        status: 'QUOTING',
        groupName: 'Grupo catálogo',
        city: 'Montreal',
        countryCode: 'CA',
        departureDate: new Date('2031-06-25'),
        returnDate: new Date('2031-07-02'),
        participants: 12,
      },
    })
  ).id;
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

const api = () => ctx.http();
const add = (body: object) => api().post('/api/v1/proposal-items').set('Cookie', sysAdmin).send(body);

describe('Incluye / No incluye catalog', () => {
  it('system admins maintain it with audit; others only read the active phrases', async () => {
    const label = `Coordinador 24/7 ${uniq()}`;
    const created = (await add({ label }).expect(201)).body;
    expect(created).toMatchObject({ label, excluded: false, isDefault: false, active: true });
    await add({ label }).expect(409);
    // Same text may live once per side.
    await add({ label, excluded: true }).expect(201);
    await api()
      .patch(`/api/v1/proposal-items/${created.id}`)
      .set('Cookie', sysAdmin)
      .send({ active: false })
      .expect(200);
    const seen = (await api().get('/api/v1/proposal-items').set('Cookie', quoter).expect(200)).body;
    expect(seen.some((i: { id: string }) => i.id === created.id)).toBe(false);
    const log = await prisma.auditLog.findMany({
      where: { entityId: created.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(log.map((l) => l.action)).toEqual(['proposal_item.created', 'proposal_item.updated']);
  });

  it('rejects other roles, blank labels and other agencies', async () => {
    await api().post('/api/v1/proposal-items').set('Cookie', quoter).send({ label: 'X' }).expect(403);
    await api().post('/api/v1/proposal-items').set('Cookie', officeAdmin).send({ label: 'X' }).expect(403);
    await add({ label: '   ' }).expect(400);
    await api().get('/api/v1/proposal-items').expect(401);
    // EE's starter phrases exist but belong to another agency.
    const ee = await prisma.proposalItem.findFirstOrThrow({
      where: { label: 'Propinas', agency: { code: 'EE' } },
    });
    await api()
      .patch(`/api/v1/proposal-items/${ee.id}`)
      .set('Cookie', sysAdmin)
      .send({ label: 'Hackeado' })
      .expect(404);
  });

  it('ticks "Siempre marcado" phrases in new scenarios and adds picked ones to Incluye', async () => {
    const inc = `Certificado ${uniq()}`;
    const exc = `Propinas ${uniq()}`;
    await add({ label: inc, isDefault: true }).expect(201);
    await add({ label: exc, excluded: true, isDefault: true }).expect(201);
    const v = (
      await api()
        .post(`/api/v1/requests/${requestId}/scenarios`)
        .set('Cookie', quoter)
        .send({ name: 'Opción 1', saleCurrency: 'CAD' })
        .expect(201)
    ).body.latest;
    expect(v.extraIncludes).toEqual([inc]);
    expect(v.exclusions).toEqual([exc]);

    const saved = await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', quoter)
      .send({
        rowVersion: v.rowVersion,
        lines: [
          {
            category: 'PER_PARTICIPANT',
            description: 'Curso',
            quantity: '1',
            unitCost: '900',
            currency: 'CAD',
          },
        ],
        // A picked phrase equal to a priced concept shows once.
        extraIncludes: [inc, 'Curso'],
      })
      .expect(200);
    expect(saved.body.extraIncludes).toEqual([inc, 'Curso']);
    const p = await api().get(`/api/v1/quotes/${v.id}/proposal`).set('Cookie', quoter).expect(200);
    expect(p.body.includes).toEqual(['Curso', inc]);
    expect(p.body.exclusions).toEqual([exc]);

    const dup = await api()
      .post(`/api/v1/scenarios/${v.scenarioId}/duplicate`)
      .set('Cookie', quoter)
      .send({ name: 'Copia' })
      .expect(201);
    expect(dup.body.latest.extraIncludes).toEqual([inc, 'Curso']);
  });
});
