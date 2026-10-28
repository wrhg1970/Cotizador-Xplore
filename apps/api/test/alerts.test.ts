import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_SETTINGS } from '@ee/contracts';
import { computeAlerts, sendDigest } from '../src/alerts/alerts.js';
import { FakeMailer, loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const ids: Record<string, string> = {};
const c: Record<string, string> = {};
let officeId: string;
const NOW = new Date('2030-05-20T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

async function request(status: 'SUBMITTED' | 'SENT' | 'WON' | 'QUOTING', createdAt: Date, assigned = true) {
  return prisma.travelRequest.create({
    data: {
      folio: `EE-2030-${uniq().toUpperCase()}`,
      officeId,
      requesterId: ids.advisor!,
      assigneeId: assigned ? ids.quoter! : null,
      status: status === 'WON' ? 'SENT' : status,
      groupName: 'Grupo alertas',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2031-03-19'),
      returnDate: new Date('2031-03-25'),
      participants: 10,
      createdAt,
    },
  });
}

async function version(requestId: string, status: 'IN_REVIEW' | 'SENT', extra: object = {}) {
  const sc = await prisma.quoteScenario.create({
    data: { requestId, name: 'Opción 1', createdById: ids.quoter! },
  });
  return prisma.quoteVersion.create({
    data: {
      scenarioId: sc.id,
      number: 1,
      status,
      saleCurrency: 'MXN',
      targetMarginRate: '0.1',
      participants: 10,
      chaperones: 0,
      staff: 0,
      createdById: ids.quoter!,
      lines: {
        create: [
          {
            position: 0,
            category: 'PER_PARTICIPANT',
            description: 'Hotel',
            quantity: 1,
            unitCost: 900,
            currency: 'MXN',
          },
        ],
      },
      ...extra,
    },
  });
}

beforeAll(async () => {
  ctx = await makeApp();
  officeId = (await makeOffice()).id;
  for (const [key, role] of [
    ['advisor', 'ADVISOR'],
    ['quoter', 'QUOTER'],
    ['approver', 'APPROVER'],
    ['admin', 'OFFICE_ADMIN'],
    ['sysadmin', 'SYSTEM_ADMIN'],
  ] as const) {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  }
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('overdue alerts', () => {
  it('finds each kind past its threshold, for the right people', async () => {
    const old = await request('SUBMITTED', daysAgo(5), false);
    const fresh = await request('SUBMITTED', daysAgo(1));
    const review = await request('QUOTING', daysAgo(10));
    const inReview = await version(review.id, 'IN_REVIEW', { updatedAt: daysAgo(3) });
    const sent = await request('SENT', daysAgo(20));
    const sentV = await version(sent.id, 'SENT');
    await prisma.proposalDelivery.create({
      data: {
        versionId: sentV.id,
        sentById: ids.quoter!,
        recipients: 'colegio',
        channel: 'EMAIL',
        sentOn: daysAgo(8),
      },
    });
    const won = await request('WON', daysAgo(30));
    const wonV = await version(won.id, 'SENT', {
      paymentPlan: { installments: 3, frequency: 'MONTHLY', firstDueDate: '2030-05-23' },
    });
    await prisma.travelRequest.update({
      where: { id: won.id },
      data: { status: 'WON', wonVersionId: wonV.id },
    });

    const mine = new Set([old.id, fresh.id, review.id, sent.id, won.id]);
    const alerts = (await computeAlerts(prisma, DEFAULT_ALERT_SETTINGS, NOW)).filter((a) =>
      mine.has(a.requestId),
    );
    const by = (kind: string) => alerts.filter((a) => a.kind === kind);

    expect(by('UNQUOTED').map((a) => [a.requestId, a.userIds])).toEqual([[old.id, [ids.admin]]]);
    expect(by('REVIEW_PENDING')).toMatchObject([
      { requestId: review.id, quoteId: inReview.id, userIds: [ids.approver] },
    ]);
    expect(by('SENT_NO_ANSWER')).toMatchObject([{ requestId: sent.id, userIds: [ids.advisor, ids.quoter] }]);
    // Only the payment due within 5 days; the next one is a month later.
    expect(by('PAYMENT_DUE')).toMatchObject([
      { requestId: won.id, detail: 'El pago 1 de los alumnos vence el 2030-05-23' },
    ]);
    expect(JSON.stringify(alerts)).not.toMatch(/900|990|1000/);

    const off = await computeAlerts(
      prisma,
      { unquotedDays: 0, reviewDays: 0, sentNoAnswerDays: 0, paymentReminderDays: 0 },
      NOW,
    );
    expect(off).toEqual([]);
  });

  it('sends one digest per person once a day', async () => {
    await prisma.appSetting.deleteMany({ where: { key: 'alerts.lastDigest' } });
    const mailer = new FakeMailer();
    const first = await sendDigest(prisma, mailer, 'https://web.example', NOW);
    expect(first).toMatchObject({ sent: expect.any(Number) });
    const toAdvisor = mailer.sent.filter((m) => m.text.includes('Grupo alertas'));
    expect(toAdvisor.length).toBeGreaterThan(0);
    expect(toAdvisor[0]!.text).toContain('https://web.example/');
    expect(await sendDigest(prisma, mailer, 'https://web.example', NOW)).toEqual({
      skipped: 'already sent today',
    });
  });

  it('only a system admin changes the thresholds, audited and validated', async () => {
    const put = (cookie: string, body: object) =>
      ctx.http().put('/api/v1/settings/alerts').set('Cookie', cookie).send(body);
    const body = { unquotedDays: 4, reviewDays: 1, sentNoAnswerDays: 10, paymentReminderDays: 7 };
    await put(c.admin!, body).expect(403);
    await put(c.sysadmin!, { ...body, reviewDays: -1 }).expect(400);
    await put(c.sysadmin!, body).expect(200);
    expect(
      (await ctx.http().get('/api/v1/settings/alerts').set('Cookie', c.quoter!).expect(200)).body,
    ).toEqual(body);
    await prisma.auditLog.findFirstOrThrow({
      where: { action: 'settings.alerts.updated', actorUserId: ids.sysadmin },
    });
    await put(c.sysadmin!, DEFAULT_ALERT_SETTINGS).expect(200);
  });

  it('"Mi trabajo" lists only my alerts', async () => {
    const r = await request('SUBMITTED', new Date(Date.now() - 30 * 86_400_000));
    const quoter = (await ctx.http().get('/api/v1/dashboard').set('Cookie', c.quoter!).expect(200)).body;
    expect(quoter.alerts.some((a: { requestId: string }) => a.requestId === r.id)).toBe(true);
    expect(quoter.alerts[0].userIds).toBeUndefined();
    const approver = (await ctx.http().get('/api/v1/dashboard').set('Cookie', c.approver!).expect(200)).body;
    expect(approver.alerts.some((a: { requestId: string }) => a.requestId === r.id)).toBe(false);
  });
});
