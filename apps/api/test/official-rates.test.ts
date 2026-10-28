import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let sysadmin: string;
let quoter: string;
let officeId: string;
let advisor: string;

const rate = (rate: string, rateDate = '2026-10-28') => ({
  fromCurrency: 'EUR',
  toCurrency: 'MXN',
  rate,
  rateDate,
  source: 'Banxico FIX',
});

beforeAll(async () => {
  ctx = await makeApp();
  officeId = (await makeOffice()).id;
  sysadmin = (await loginAs(ctx, (await makeUser([{ officeId, role: 'SYSTEM_ADMIN' }])).email)).cookie!;
  quoter = (await loginAs(ctx, (await makeUser([{ officeId, role: 'QUOTER' }])).email)).cookie!;
  advisor = (await loginAs(ctx, (await makeUser([{ officeId, role: 'ADVISOR' }])).email)).cookie!;
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('official exchange rates', () => {
  it('a system admin publishes; everyone reads the latest per pair; history stays', async () => {
    const post = (body: object) =>
      ctx.http().post('/api/v1/official-rates').set('Cookie', sysadmin).send(body);
    const first = (await post(rate('20.10')).expect(201)).body.id as string;
    const second = (await post(rate('20.39')).expect(201)).body.id as string;
    const list = (await ctx.http().get('/api/v1/official-rates').set('Cookie', quoter).expect(200)).body;
    const eur = list.filter(
      (r: { fromCurrency: string; toCurrency: string }) => r.fromCurrency === 'EUR' && r.toCurrency === 'MXN',
    );
    expect(eur).toHaveLength(1);
    expect(eur[0]).toMatchObject({
      id: second,
      rate: '20.39',
      source: 'Banxico FIX',
      rateDate: '2026-10-28',
    });
    expect(await prisma.officialRate.count({ where: { id: { in: [first, second] } } })).toBe(2);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'official_rate.published', entityId: second },
    });
    expect(log.diff).toMatchObject({ rate: '20.39', fromCurrency: 'EUR' });
  });

  it('history is append-only in the database', async () => {
    await expect(prisma.officialRate.updateMany({ data: { source: 'x' } })).rejects.toThrow(/append-only/);
  });

  it('refuses other roles and invalid rates', async () => {
    const post = (cookie: string, body: object) =>
      ctx.http().post('/api/v1/official-rates').set('Cookie', cookie).send(body);
    await post(quoter, rate('20')).expect(403);
    await post(advisor, rate('20')).expect(403);
    await post(sysadmin, rate('0')).expect(400);
    await post(sysadmin, rate('-1')).expect(400);
    await post(sysadmin, { ...rate('20'), toCurrency: 'EUR' }).expect(400);
    await post(sysadmin, { ...rate('20'), toCurrency: 'JPY' }).expect(400);
    await post(sysadmin, { ...rate('20'), extra: 1 }).expect(400);
    await ctx.http().get('/api/v1/official-rates').expect(401);
  });
});
