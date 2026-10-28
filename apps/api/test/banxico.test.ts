import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Banxico, type BanxicoRate, parseSie } from '../src/rates/banxico.js';
import { FakeOidc, loginAs, makeApp, makeOffice, makeUser, prisma, testEnv } from './helpers.js';

const SECRET = 'cron-test-secret-0123456789abcdef0123';

class FakeBanxico implements Banxico {
  rates: BanxicoRate[] = [];
  fail = false;
  async latest() {
    if (this.fail) throw new Error('Banxico respondió 503');
    return this.rates;
  }
}

const fake = new FakeBanxico();
let ctx: Awaited<ReturnType<typeof makeApp>>;
let off: Awaited<ReturnType<typeof makeApp>>;
let sysadmin: string;
let quoter: string;

beforeAll(async () => {
  ctx = await makeApp(
    new FakeOidc(),
    undefined,
    undefined,
    undefined,
    fake,
    testEnv({ CRON_SECRET: SECRET }),
  );
  off = await makeApp();
  const officeId = (await makeOffice()).id;
  sysadmin = (await loginAs(ctx, (await makeUser([{ officeId, role: 'SYSTEM_ADMIN' }])).email)).cookie!;
  quoter = (await loginAs(ctx, (await makeUser([{ officeId, role: 'QUOTER' }])).email)).cookie!;
});
afterAll(async () => {
  await ctx.app.close();
  await off.app.close();
  await prisma.$disconnect();
});

describe('Banxico SIE parsing', () => {
  it('takes the last value per known series and skips N/E or unknown series', () => {
    expect(
      parseSie({
        bmx: {
          series: [
            { idSerie: 'SF43718', datos: [{ fecha: '27/10/2026', dato: '18.4521' }] },
            { idSerie: 'SF46410', datos: [{ fecha: '27/10/2026', dato: 'N/E' }] },
            { idSerie: 'SF99999', datos: [{ fecha: '27/10/2026', dato: '1.0' }] },
          ],
        },
      }),
    ).toEqual([
      {
        fromCurrency: 'USD',
        toCurrency: 'MXN',
        rate: '18.4521',
        rateDate: '2026-10-27',
        source: 'Banxico FIX (SIE SF43718)',
      },
    ]);
    expect(parseSie({})).toEqual([]);
  });
});

describe('automatic official rates', () => {
  const usd = (rate: string, rateDate: string): BanxicoRate => ({
    fromCurrency: 'USD',
    toCurrency: 'MXN',
    rate,
    rateDate,
    source: 'Banxico FIX (SIE SF43718)',
  });
  const cron = (secret?: string) => {
    const r = ctx.http().post('/api/v1/cron/daily');
    return secret ? r.set('X-Cron-Secret', secret) : r;
  };
  const currentUsd = async () =>
    (
      (await ctx.http().get('/api/v1/official-rates').set('Cookie', quoter).expect(200)).body as {
        fromCurrency: string;
        toCurrency: string;
        rate: string;
        capturedBy: string;
      }[]
    ).find((r) => r.fromCurrency === 'USD' && r.toCurrency === 'MXN');

  it('the daily job publishes once per date, by the process, with audit', async () => {
    fake.rates = [usd('18.1000', '2091-01-02')];
    expect((await cron(SECRET).expect(200)).body.banxico).toEqual({ published: ['USD/MXN'] });
    expect((await cron(SECRET).expect(200)).body.banxico).toEqual({ published: [] });
    expect(await currentUsd()).toMatchObject({ rate: '18.1', capturedBy: 'Proceso automático' });
    const row = await prisma.officialRate.findFirstOrThrow({
      where: { fromCurrency: 'USD', rateDate: new Date('2091-01-02') },
    });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: row.id } });
    expect(log).toMatchObject({ action: 'official_rate.published', actorUserId: null });
  });

  it('a Banxico outage keeps the last rate and is reported', async () => {
    fake.fail = true;
    expect((await cron(SECRET).expect(200)).body.banxico).toEqual({ error: 'Banxico respondió 503' });
    fake.fail = false;
    expect(await currentUsd()).toMatchObject({ rate: '18.1' });
  });

  it('only a system admin can pull from Banxico by hand', async () => {
    fake.rates = [usd('18.2000', '2091-01-03')];
    await ctx.http().post('/api/v1/official-rates/banxico').set('Cookie', quoter).expect(403);
    const res = await ctx.http().post('/api/v1/official-rates/banxico').set('Cookie', sysadmin).expect(201);
    expect(res.body).toEqual({ published: ['USD/MXN'] });
    expect((await currentUsd())?.capturedBy).not.toBe('Proceso automático');
  });

  it('rejects a wrong or missing secret, and is hidden when not configured', async () => {
    await cron().expect(401);
    await cron('x'.repeat(SECRET.length)).expect(401);
    await off.http().post('/api/v1/cron/daily').set('X-Cron-Secret', SECRET).expect(404);
    const offAdmin = (
      await loginAs(
        off,
        (await makeUser([{ officeId: (await makeOffice()).id, role: 'SYSTEM_ADMIN' }])).email,
      )
    ).cookie!;
    await off.http().post('/api/v1/official-rates/banxico').set('Cookie', offAdmin).expect(503);
  });
});
