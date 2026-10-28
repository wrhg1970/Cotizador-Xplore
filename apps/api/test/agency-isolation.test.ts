import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeAgency, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

/**
 * Tenant isolation: an agency never sees or changes another agency's data, even its system admin
 * with the other agency's ids in hand. "Mine" is EE (the default agency), "theirs" a second agency.
 */
let ctx: Awaited<ReturnType<typeof makeApp>>;
const mine = { cookie: '', officeId: '', requestId: '' };
const theirs = {
  cookie: '',
  agencyId: '',
  officeId: '',
  requestId: '',
  userId: '',
  email: '',
  supplierId: '',
  school: '',
};

async function makeRequest(officeId: string, requesterId: string, clientName: string) {
  return prisma.travelRequest.create({
    data: {
      folio: `EE-2030-${uniq().toUpperCase().slice(0, 6)}`,
      officeId,
      requesterId,
      status: 'SUBMITTED',
      groupName: 'Grupo aislamiento',
      clientName,
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2031-03-19'),
      returnDate: new Date('2031-03-25'),
      participants: 10,
    },
  });
}

beforeAll(async () => {
  ctx = await makeApp();
  mine.officeId = (await makeOffice()).id;
  const me = await makeUser([{ officeId: mine.officeId, role: 'SYSTEM_ADMIN' }]);
  mine.cookie = (await loginAs(ctx, me.email)).cookie!;
  mine.requestId = (await makeRequest(mine.officeId, me.id, `Colegio EE ${uniq()}`)).id;

  theirs.agencyId = (await makeAgency()).id;
  theirs.officeId = (await makeOffice(theirs.agencyId)).id;
  const them = await makeUser(
    [{ officeId: theirs.officeId, role: 'SYSTEM_ADMIN' }],
    'INVITED',
    theirs.agencyId,
  );
  theirs.userId = them.id;
  theirs.email = them.email;
  theirs.cookie = (await loginAs(ctx, them.email)).cookie!;
  theirs.school = `Colegio ajeno ${uniq()}`;
  theirs.requestId = (await makeRequest(theirs.officeId, them.id, theirs.school)).id;

  // The other agency fills its own catalogs and settings through the API.
  const api = () => ctx.http();
  theirs.supplierId = (
    await api()
      .post('/api/v1/suppliers')
      .set('Cookie', theirs.cookie)
      .send({ name: `DMC ajeno ${uniq()}` })
      .expect(201)
  ).body.id;
  await api()
    .post('/api/v1/concept-templates')
    .set('Cookie', theirs.cookie)
    .send({ label: `Rubro ajeno ${uniq()}`, category: 'PER_GROUP' })
    .expect(201);
  await api()
    .post('/api/v1/official-rates')
    .set('Cookie', theirs.cookie)
    .send({
      fromCurrency: 'GBP',
      toCurrency: 'MXN',
      rate: '99.5',
      rateDate: '2030-01-02',
      source: 'Fuente ajena',
    })
    .expect(201);
  await api()
    .put('/api/v1/settings/alerts')
    .set('Cookie', theirs.cookie)
    .send({ unquotedDays: 9, reviewDays: 9, sentNoAnswerDays: 9, paymentReminderDays: 9 })
    .expect(200);
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

const get = (path: string, cookie = mine.cookie) => ctx.http().get(`/api/v1${path}`).set('Cookie', cookie);

describe('agency isolation', () => {
  it('lists only the own agency: requests, offices, schools, dashboard', async () => {
    const requests = JSON.stringify((await get('/requests').expect(200)).body);
    expect(requests).toContain(mine.requestId);
    expect(requests).not.toContain(theirs.requestId);
    for (const path of ['/offices', '/offices/all']) {
      const ids = ((await get(path).expect(200)).body as { id: string }[]).map((o) => o.id);
      expect(ids).toContain(mine.officeId);
      expect(ids).not.toContain(theirs.officeId);
    }
    expect(JSON.stringify((await get('/schools').expect(200)).body)).not.toContain(theirs.school);
    expect(JSON.stringify((await get('/dashboard').expect(200)).body)).not.toContain(theirs.requestId);
  });

  it("a system admin can't open or change the other agency's records by id", async () => {
    const api = () => ctx.http();
    await get(`/requests/${theirs.requestId}`).expect(404);
    await get(`/users?officeId=${theirs.officeId}`).expect(404);
    await get(`/dashboard/executive?officeId=${theirs.officeId}`).expect(403);
    await get(`/audit-logs?officeId=${theirs.officeId}`).expect(403);
    await api()
      .patch(`/api/v1/offices/${theirs.officeId}`)
      .set('Cookie', mine.cookie)
      .send({ name: 'X' })
      .expect(404);
    await api().delete(`/api/v1/offices/${theirs.officeId}`).set('Cookie', mine.cookie).expect(404);
    await api()
      .patch(`/api/v1/suppliers/${theirs.supplierId}`)
      .set('Cookie', mine.cookie)
      .send({ notes: 'x' })
      .expect(404);
    await api()
      .post(`/api/v1/suppliers/${theirs.supplierId}/rates`)
      .set('Cookie', mine.cookie)
      .send({ description: 'x', category: 'PER_GROUP', unitCost: '1', currency: 'EUR' })
      .expect(404);
    await api().post(`/api/v1/users/${theirs.userId}/disable`).set('Cookie', mine.cookie).expect(404);
    await api()
      .post(`/api/v1/users/${theirs.userId}/roles`)
      .set('Cookie', mine.cookie)
      .send({ officeId: mine.officeId, role: 'QUOTER' })
      .expect(404);
    await api()
      .post('/api/v1/users')
      .set('Cookie', mine.cookie)
      .send({ email: theirs.email, name: 'Ajeno', officeId: mine.officeId, role: 'QUOTER' })
      .expect(409);
    await api()
      .post('/api/v1/users')
      .set('Cookie', mine.cookie)
      .send({
        email: `nuevo-${uniq()}@ee-test.example`,
        name: 'Ajeno',
        officeId: theirs.officeId,
        role: 'QUOTER',
      })
      .expect(403);
    expect((await prisma.office.findUniqueOrThrow({ where: { id: theirs.officeId } })).active).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: theirs.userId } })).status).toBe('ACTIVE');
  });

  it('catalogs, exchange rates, settings and role policies are per agency', async () => {
    const suppliers = (await get('/suppliers').expect(200)).body as { id: string }[];
    expect(suppliers.map((s) => s.id)).not.toContain(theirs.supplierId);
    expect(JSON.stringify((await get('/concept-templates').expect(200)).body)).not.toContain('Rubro ajeno');
    expect(JSON.stringify((await get('/official-rates').expect(200)).body)).not.toContain('Fuente ajena');
    expect((await get('/settings/alerts').expect(200)).body.unquotedDays).not.toBe(9);
    expect((await get('/settings/alerts', theirs.cookie).expect(200)).body.unquotedDays).toBe(9);

    await ctx
      .http()
      .put('/api/v1/role-policies/ADVISOR')
      .set('Cookie', theirs.cookie)
      .send({
        allOffices: true,
        canView: true,
        canCreate: true,
        canEdit: true,
        canDelete: false,
        viewInternalCosts: false,
        exportInternalXlsx: false,
        approvalLimitMxn: null,
      })
      .expect(200);
    const advisor = (
      (await get('/role-policies').expect(200)).body as { role: string; allOffices: boolean }[]
    ).find((p) => p.role === 'ADVISOR');
    expect(advisor?.allOffices).toBe(false);
  });

  it('the audit log shows each agency only its own entries, agency-wide ones included', async () => {
    const theirLog = JSON.stringify(
      (await get('/audit-logs?action=supplier', theirs.cookie).expect(200)).body,
    );
    expect(theirLog).toContain(theirs.supplierId);
    const myLog = JSON.stringify((await get('/audit-logs?action=supplier').expect(200)).body);
    expect(myLog).not.toContain(theirs.supplierId);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId: theirs.supplierId } });
    expect(row.agencyId).toBe(theirs.agencyId);
  });

  it('a user of an inactive agency loses access on the next request', async () => {
    await prisma.agency.update({ where: { id: theirs.agencyId }, data: { active: false } });
    await get('/me', theirs.cookie).expect(401);
    await prisma.agency.update({ where: { id: theirs.agencyId }, data: { active: true } });
  });
});
