import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let officeA: string;
let officeB: string;
const c: Record<'advisor' | 'advisor2' | 'quoter' | 'adminA' | 'adminB' | 'quoterB', string> = {} as never;
const ids: Record<string, string> = {};

const body = (officeId: string, patch: object = {}) => ({
  officeId,
  groupName: 'Verano Grupal UK 2027',
  city: 'Londres y Oxford',
  countryCode: 'GB',
  departureDate: '2027-07-01',
  returnDate: '2027-07-21',
  participants: 20,
  chaperones: 2,
  budget: { amount: '5150.00', currency: 'GBP', basis: 'PER_PARTICIPANT' },
  requirements: 'Sol Camps',
  ...patch,
});

beforeAll(async () => {
  ctx = await makeApp();
  officeA = (await makeOffice()).id;
  officeB = (await makeOffice()).id;
  const login = async (
    key: keyof typeof c,
    officeId: string,
    role: Parameters<typeof makeUser>[0][number]['role'],
  ) => {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  };
  await login('advisor', officeA, 'ADVISOR');
  await login('advisor2', officeA, 'ADVISOR');
  await login('quoter', officeA, 'QUOTER');
  await login('adminA', officeA, 'OFFICE_ADMIN');
  await login('adminB', officeB, 'OFFICE_ADMIN');
  await login('quoterB', officeB, 'QUOTER');
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

const api = () => ctx.http();
const create = (cookie: string, payload = body(officeA)) =>
  api().post('/api/v1/requests').set('Cookie', cookie).send(payload);

describe('create (US-009, US-012..016, US-196)', () => {
  it('advisor creates a draft with folio, server-side requester and audit', async () => {
    const res = await create(c.advisor).expect(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      version: 1,
      requester: { id: ids.advisor },
      staff: 0,
      priority: 'NORMAL',
      budget: { amount: '5150.00', currency: 'GBP', basis: 'PER_PARTICIPANT' },
      departureDate: '2027-07-01',
    });
    expect(res.body.folio).toMatch(/^EE-\d{4}-[2-9A-HJ-NP-Z]{6}$/);
    expect(await prisma.auditLog.count({ where: { entityId: res.body.id, action: 'request.created' } })).toBe(
      1,
    );
  });

  it('rejects other offices, wrong roles and invalid data', async () => {
    await create(c.advisor, body(officeB)).expect(403);
    await create(c.quoter).expect(403);
    const bad = await create(c.advisor, body(officeA, { returnDate: '2027-06-01' })).expect(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    await create(c.advisor, body(officeA, { requesterId: ids.advisor2 })).expect(400);
  });

  it('database rejects invariants even if the API were bypassed', async () => {
    const r = (await create(c.advisor).expect(201)).body;
    await expect(
      prisma.travelRequest.update({ where: { id: r.id }, data: { participants: 0 } }),
    ).rejects.toThrow();
    await expect(
      prisma.travelRequest.update({ where: { id: r.id }, data: { status: 'CANCELLED', cancelReason: null } }),
    ).rejects.toThrow();
  });
});

describe('visibility (US-004, US-010)', () => {
  it('drafts are private; other offices get 404', async () => {
    const r = (await create(c.advisor).expect(201)).body;
    await api().get(`/api/v1/requests/${r.id}`).set('Cookie', c.advisor).expect(200);
    await api().get(`/api/v1/requests/${r.id}`).set('Cookie', c.adminA).expect(200);
    await api().get(`/api/v1/requests/${r.id}`).set('Cookie', c.advisor2).expect(404);
    await api().get(`/api/v1/requests/${r.id}`).set('Cookie', c.adminB).expect(404);
    await api()
      .patch(`/api/v1/requests/${r.id}`)
      .set('Cookie', c.adminB)
      .send({ version: 1, city: 'X' })
      .expect(404);

    const list = await api().get('/api/v1/requests').set('Cookie', c.adminB).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(r.id);
  });
});

describe('workflow (US-011, US-020, US-024, US-027, US-142)', () => {
  it('draft → submitted → quoting with assignment, then audited edit', async () => {
    let r = (await create(c.advisor).expect(201)).body;

    // Partial edit keeps other fields and bumps version.
    r = (
      await api()
        .patch(`/api/v1/requests/${r.id}`)
        .set('Cookie', c.advisor)
        .send({ version: 1, city: 'Londres' })
        .expect(200)
    ).body;
    expect(r).toMatchObject({ city: 'Londres', chaperones: 2, version: 2 });

    // Stale version → 409.
    const stale = await api()
      .patch(`/api/v1/requests/${r.id}`)
      .set('Cookie', c.advisor)
      .send({ version: 1, city: 'Oxford' })
      .expect(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');

    await api()
      .post(`/api/v1/requests/${r.id}/assign`)
      .set('Cookie', c.adminA)
      .send({ assigneeId: ids.quoter, version: 2 })
      .expect(403);
    r = (
      await api()
        .post(`/api/v1/requests/${r.id}/submit`)
        .set('Cookie', c.advisor)
        .send({ version: 2 })
        .expect(201)
    ).body;
    expect(r.status).toBe('SUBMITTED');

    // Now visible to colleagues.
    await api().get(`/api/v1/requests/${r.id}`).set('Cookie', c.advisor2).expect(200);

    // Only office admins assign, and only quoters of that office.
    await api()
      .post(`/api/v1/requests/${r.id}/assign`)
      .set('Cookie', c.advisor)
      .send({ assigneeId: ids.quoter, version: 3 })
      .expect(403);
    const wrong = await api()
      .post(`/api/v1/requests/${r.id}/assign`)
      .set('Cookie', c.adminA)
      .send({ assigneeId: ids.quoterB, version: 3 })
      .expect(400);
    expect(wrong.body.code).toBe('INVALID_ASSIGNEE');
    r = (
      await api()
        .post(`/api/v1/requests/${r.id}/assign`)
        .set('Cookie', c.adminA)
        .send({ assigneeId: ids.quoter, version: 3 })
        .expect(201)
    ).body;
    expect(r).toMatchObject({ status: 'QUOTING', assignee: { id: ids.quoter } });

    // Inbox (US-021).
    const inbox = await api().get('/api/v1/requests?assignedToMe=true').set('Cookie', c.quoter).expect(200);
    expect(inbox.body.items.map((i: { id: string }) => i.id)).toContain(r.id);

    // Assignee edits after submission → audited with field diff (US-027).
    r = (
      await api()
        .patch(`/api/v1/requests/${r.id}`)
        .set('Cookie', c.quoter)
        .send({ version: 4, participants: 25 })
        .expect(200)
    ).body;
    const edit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: r.id, action: 'request.updated_after_submit' },
    });
    expect(edit.diff).toEqual({ participants: { from: 20, to: 25 } });

    // Cancel requires reason and admin; closed requests can't be edited.
    await api()
      .post(`/api/v1/requests/${r.id}/cancel`)
      .set('Cookie', c.advisor)
      .send({ reason: 'x', version: 5 })
      .expect(403);
    await api()
      .post(`/api/v1/requests/${r.id}/cancel`)
      .set('Cookie', c.adminA)
      .send({ version: 5 })
      .expect(400);
    r = (
      await api()
        .post(`/api/v1/requests/${r.id}/cancel`)
        .set('Cookie', c.adminA)
        .send({ reason: 'El cliente pospuso el viaje', version: 5 })
        .expect(201)
    ).body;
    expect(r).toMatchObject({ status: 'CANCELLED', cancelReason: 'El cliente pospuso el viaje' });
    await api()
      .patch(`/api/v1/requests/${r.id}`)
      .set('Cookie', c.adminA)
      .send({ version: 6, city: 'X' })
      .expect(403);

    // Timeline (US-022) shows the whole story in order.
    const tl = await api().get(`/api/v1/requests/${r.id}/timeline`).set('Cookie', c.advisor).expect(200);
    expect(tl.body.events.map((e: { action: string }) => e.action)).toEqual([
      'request.created',
      'request.updated',
      'request.submitted',
      'request.assigned',
      'request.updated_after_submit',
      'request.cancelled',
    ]);
    expect(tl.body.events[0].actor.id).toBe(ids.advisor);
  });

  it('rejects a date change that inverts the stored dates', async () => {
    const r = (await create(c.advisor).expect(201)).body;
    await api()
      .patch(`/api/v1/requests/${r.id}`)
      .set('Cookie', c.advisor)
      .send({ version: 1, returnDate: '2027-06-01' })
      .expect(400);
  });
});

describe('search, filters and comments (US-018, US-019, US-023)', () => {
  it('finds by folio and by group name, paginated', async () => {
    const r = (await create(c.advisor, body(officeA, { groupName: 'Grupo Búsqueda Única' })).expect(201))
      .body;
    const byFolio = await api()
      .get(`/api/v1/requests?q=${r.folio.toLowerCase()}`)
      .set('Cookie', c.advisor)
      .expect(200);
    expect(byFolio.body.items.map((i: { id: string }) => i.id)).toEqual([r.id]);
    const byName = await api().get('/api/v1/requests?q=búsqueda única').set('Cookie', c.advisor).expect(200);
    expect(byName.body.items.map((i: { id: string }) => i.id)).toEqual([r.id]);
    const page = await api()
      .get('/api/v1/requests?limit=1&status=DRAFT')
      .set('Cookie', c.advisor)
      .expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBeGreaterThan(1);
    await api().get('/api/v1/requests?limit=1000').set('Cookie', c.advisor).expect(400);
  });

  it('comments are scoped and appear in the timeline', async () => {
    const r = (await create(c.advisor).expect(201)).body;
    await api()
      .post(`/api/v1/requests/${r.id}/comments`)
      .set('Cookie', c.adminB)
      .send({ body: 'hola' })
      .expect(404);
    await api()
      .post(`/api/v1/requests/${r.id}/comments`)
      .set('Cookie', c.advisor)
      .send({ body: '  ' })
      .expect(400);
    const cm = await api()
      .post(`/api/v1/requests/${r.id}/comments`)
      .set('Cookie', c.advisor)
      .send({ body: '<b>Hotel céntrico</b>' })
      .expect(201);
    expect(cm.body.body).toBe('<b>Hotel céntrico</b>');
    const tl = await api().get(`/api/v1/requests/${r.id}/timeline`).set('Cookie', c.advisor).expect(200);
    expect(tl.body.comments).toHaveLength(1);
  });
});

describe('catalogs', () => {
  it('lists countries in Spanish and currencies', async () => {
    const countries = await api().get('/api/v1/catalogs/countries').set('Cookie', c.advisor).expect(200);
    expect(countries.body).toContainEqual({ code: 'GB', name: 'Reino Unido' });
    expect(countries.body).toContainEqual({ code: 'MX', name: 'México' });
    const codes = countries.body.map((x: { code: string }) => x.code);
    expect(codes).not.toContain('UK');
    expect(codes).not.toContain('EU');
    const currencies = await api().get('/api/v1/catalogs/currencies').set('Cookie', c.advisor).expect(200);
    expect(currencies.body).toContain('MXN');
  });

  it('quoter picker is office-admin only', async () => {
    const res = await api().get(`/api/v1/offices/${officeA}/quoters`).set('Cookie', c.adminA).expect(200);
    expect(res.body.map((q: { id: string }) => q.id)).toEqual([ids.quoter]);
    await api().get(`/api/v1/offices/${officeA}/quoters`).set('Cookie', c.adminB).expect(404);
  });
});
