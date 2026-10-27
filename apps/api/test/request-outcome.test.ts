import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'advisor' | 'quoter' | 'adminA' | 'adminB', string> = {} as never;
const ids: Record<string, string> = {};
let officeA: string;

const api = () => ctx.http();

/** A request already sent to the client, with two scenarios: one version sent, one still a draft. */
async function sentRequest() {
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
  const version = async (name: string, status: 'SENT' | 'DRAFT') =>
    prisma.quoteVersion.create({
      data: {
        scenarioId: (
          await prisma.quoteScenario.create({ data: { requestId: r.id, name, createdById: ids.quoter! } })
        ).id,
        number: 1,
        status,
        saleCurrency: 'MXN',
        participants: 10,
        chaperones: 0,
        staff: 0,
        createdById: ids.quoter!,
      },
    });
  const sent = await version('Opción 1', 'SENT');
  const draft = await version('Opción 2', 'DRAFT');
  return { id: r.id, sent: sent.id, draft: draft.id };
}

const outcome = (cookie: string, id: string, body: object) =>
  api().post(`/api/v1/requests/${id}/outcome`).set('Cookie', cookie).send(body);

beforeAll(async () => {
  ctx = await makeApp();
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
  await login('adminA', officeA, 'OFFICE_ADMIN');
  await login('adminB', officeB, 'OFFICE_ADMIN');
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('client outcome (ganada/perdida)', () => {
  it('the assignee marks a sent proposal as the winner, audited, and it cannot be changed after', async () => {
    const r = await sentRequest();
    const res = await outcome(c.quoter, r.id, { outcome: 'WON', versionId: r.sent, version: 1 }).expect(201);
    expect(res.body).toMatchObject({ status: 'WON', wonVersionId: r.sent, lostReason: null });
    expect(res.body.closedAt).toBeTruthy();

    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: 'request.won' } });
    expect(log.actorUserId).toBe(ids.quoter);
    expect(log.officeId).toBe(officeA);
    expect(log.diff).toMatchObject({ status: { from: 'SENT', to: 'WON' }, detail: { versionId: r.sent } });

    // Closed: no second winner, no switching to lost.
    await outcome(c.adminA, r.id, { outcome: 'WON', versionId: r.sent, version: 2 }).expect(403);
    await outcome(c.adminA, r.id, { outcome: 'LOST', reason: 'Cambio', version: 2 }).expect(403);
  });

  it('the office admin records a lost request with its reason', async () => {
    const r = await sentRequest();
    const res = await outcome(c.adminA, r.id, {
      outcome: 'LOST',
      reason: 'Eligió otra agencia',
      version: 1,
    }).expect(201);
    expect(res.body).toMatchObject({ status: 'LOST', lostReason: 'Eligió otra agencia', wonVersionId: null });
    await prisma.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: 'request.lost' } });
  });

  it('only a version sent for this same request can win', async () => {
    const r = await sentRequest();
    const other = await sentRequest();
    await outcome(c.quoter, r.id, { outcome: 'WON', versionId: r.draft, version: 1 }).expect(400);
    await outcome(c.quoter, r.id, { outcome: 'WON', versionId: other.sent, version: 1 }).expect(400);
    expect((await prisma.travelRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('SENT');
  });

  it('the database refuses a second request claiming the same winning version', async () => {
    const r = await sentRequest();
    await outcome(c.quoter, r.id, { outcome: 'WON', versionId: r.sent, version: 1 }).expect(201);
    const other = await sentRequest();
    await expect(
      prisma.travelRequest.update({ where: { id: other.id }, data: { status: 'WON', wonVersionId: r.sent } }),
    ).rejects.toThrow();
    await expect(
      prisma.travelRequest.update({ where: { id: other.id }, data: { status: 'WON' } }),
    ).rejects.toThrow();
    await expect(
      prisma.travelRequest.update({ where: { id: other.id }, data: { status: 'LOST' } }),
    ).rejects.toThrow();
  });

  it('refuses advisors, other offices, unsent requests, bad bodies and stale versions', async () => {
    const r = await sentRequest();
    await outcome(c.advisor, r.id, { outcome: 'LOST', reason: 'x', version: 1 }).expect(403);
    await outcome(c.adminB, r.id, { outcome: 'LOST', reason: 'x', version: 1 }).expect(404);
    await outcome(c.quoter, r.id, { outcome: 'LOST', reason: '', version: 1 }).expect(400);
    await outcome(c.quoter, r.id, { outcome: 'WON', version: 1 }).expect(400);
    await outcome(c.quoter, r.id, { outcome: 'MAYBE', version: 1 }).expect(400);
    await outcome(c.quoter, r.id, { outcome: 'LOST', reason: 'x', version: 9 }).expect(409);

    await prisma.travelRequest.update({ where: { id: r.id }, data: { status: 'QUOTING' } });
    await outcome(c.quoter, r.id, { outcome: 'LOST', reason: 'x', version: 1 }).expect(403);
    await api()
      .post(`/api/v1/requests/${r.id}/outcome`)
      .send({ outcome: 'LOST', reason: 'x', version: 1 })
      .expect(401);
  });

  it('the dashboard asks for the answer and shows it in the office counts', async () => {
    const r = await sentRequest();
    const tasks = async (cookie: string) =>
      (await api().get('/api/v1/dashboard').set('Cookie', cookie).expect(200)).body.tasks as {
        kind: string;
        requestId: string;
      }[];
    expect((await tasks(c.quoter)).filter((t) => t.requestId === r.id).map((t) => t.kind)).toEqual([
      'RECORD_OUTCOME',
    ]);
    expect((await tasks(c.adminA)).some((t) => t.requestId === r.id)).toBe(true);
    expect((await tasks(c.advisor)).some((t) => t.requestId === r.id)).toBe(false);
    expect((await tasks(c.adminB)).some((t) => t.requestId === r.id)).toBe(false);
    await outcome(c.quoter, r.id, { outcome: 'WON', versionId: r.sent, version: 1 }).expect(201);
    expect((await tasks(c.quoter)).some((t) => t.requestId === r.id)).toBe(false);
  });
});
