import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'sysadmin' | 'advisorA' | 'advisorB' | 'adminA' | 'auditorA', string> = {} as never;
const emails: Record<string, string> = {};
let officeA: string;
let officeB: string;
let requestA: string;
let requestB: string;

type Page = {
  items: { action: string; entityId: string; office: string | null; actor: { email: string } | null }[];
  total: number;
};
const logs = async (cookie: string, query = '', status = 200) =>
  (await ctx.http().get(`/api/v1/audit-logs${query}`).set('Cookie', cookie).expect(status)).body as Page;

const newRequest = async (cookie: string, officeId: string) =>
  (
    await ctx
      .http()
      .post('/api/v1/requests')
      .set('Cookie', cookie)
      .send({
        officeId,
        groupName: 'Bitácora 2027',
        city: 'Roma',
        countryCode: 'IT',
        departureDate: '2027-03-19',
        returnDate: '2027-03-25',
        participants: 10,
      })
      .expect(201)
  ).body.id as string;

beforeAll(async () => {
  ctx = await makeApp();
  const a = await makeOffice();
  const b = await makeOffice();
  officeA = a.id;
  officeB = b.id;
  const login = async (
    key: keyof typeof c,
    officeId: string,
    role: Parameters<typeof makeUser>[0][number]['role'],
  ) => {
    const u = await makeUser([{ officeId, role }]);
    emails[key] = u.email;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  };
  await login('sysadmin', officeA, 'SYSTEM_ADMIN');
  await login('advisorA', officeA, 'ADVISOR');
  await login('advisorB', officeB, 'ADVISOR');
  await login('adminA', officeA, 'OFFICE_ADMIN');
  await login('auditorA', officeA, 'AUDITOR');
  requestA = await newRequest(c.advisorA, officeA);
  requestB = await newRequest(c.advisorB, officeB);
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('audit log browser', () => {
  it('stamps the office on new entries from the audited entity', async () => {
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'request.created', entityId: requestA },
    });
    expect(row.officeId).toBe(officeA);
    const login = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.login' } });
    expect(login.officeId).toBeNull();
  });

  it('office admins and auditors read only their office; global entries stay with system admins', async () => {
    for (const cookie of [c.adminA, c.auditorA]) {
      const page = await logs(cookie, '?action=request.created');
      const ids = page.items.map((i) => i.entityId);
      expect(ids).toContain(requestA);
      expect(ids).not.toContain(requestB);
      expect((await logs(cookie, '?action=auth.')).total).toBe(0);
    }
    const all = await logs(c.sysadmin, '?action=request.created&limit=100');
    expect(all.items.map((i) => i.entityId)).toEqual(expect.arrayContaining([requestA, requestB]));
    expect((await logs(c.sysadmin, '?action=auth.login')).total).toBeGreaterThan(0);
  });

  it('filters by person, record and date, with actor and office resolved', async () => {
    const page = await logs(c.adminA, `?actorEmail=${encodeURIComponent(emails.advisorA!)}`);
    expect(page.items[0]).toMatchObject({
      action: 'request.created',
      entityId: requestA,
      actor: { email: emails.advisorA },
      office: expect.stringMatching(/^T-/),
    });
    expect((await logs(c.adminA, `?entityId=${requestA}`)).total).toBe(1);
    expect((await logs(c.adminA, '?actorEmail=nadie%40ee-test.example')).total).toBe(0);
    expect((await logs(c.adminA, `?entityId=${requestA}&to=2020-01-01`)).total).toBe(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await logs(c.adminA, `?entityId=${requestA}&from=${today}&to=${today}`)).total).toBe(1);
  });

  it('refuses other roles, other offices and bad filters', async () => {
    await logs(c.advisorA, '', 403);
    await logs(c.adminA, `?officeId=${officeB}`, 403);
    await logs(c.adminA, '?action=DROP%20TABLE', 400);
    await logs(c.adminA, '?limit=500', 400);
    await ctx.http().get('/api/v1/audit-logs').expect(401);
  });

  it('the log itself stays append-only', async () => {
    await expect(
      prisma.auditLog.updateMany({ where: { entityId: requestA }, data: { action: 'x' } }),
    ).rejects.toThrow(/append-only/);
  });
});
