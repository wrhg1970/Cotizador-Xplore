import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma, testEnv, uniq } from './helpers.js';

/**
 * Permission audit (post-launch item 7): nobody reaches another office's records by id, by list or
 * by report, whatever their role there; and sessions close after inactivity.
 */
let ctx: Awaited<ReturnType<typeof makeApp>>;
const ROLES = ['ADVISOR', 'QUOTER', 'APPROVER', 'OFFICE_ADMIN', 'AUDITOR'] as const;
const cookieA: Partial<Record<(typeof ROLES)[number], string>> = {};
let officeA: string;
let officeB: string;
const b: Record<'request' | 'version' | 'scenario' | 'attachment', string> = {} as never;

beforeAll(async () => {
  ctx = await makeApp();
  officeA = (await makeOffice()).id;
  officeB = (await makeOffice()).id;
  for (const role of ROLES) {
    const u = await makeUser([{ officeId: officeA, role }]);
    cookieA[role] = (await loginAs(ctx, u.email)).cookie!;
  }
  const owner = await makeUser([{ officeId: officeB, role: 'QUOTER' }], 'ACTIVE');
  const r = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${uniq().toUpperCase()}`,
      officeId: officeB,
      requesterId: owner.id,
      assigneeId: owner.id,
      status: 'SENT',
      groupName: 'Secreto de la oficina B',
      clientName: `Colegio B ${uniq()}`,
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 10,
    },
  });
  const s = await prisma.quoteScenario.create({
    data: { requestId: r.id, name: 'B1', createdById: owner.id },
  });
  const v = await prisma.quoteVersion.create({
    data: {
      scenarioId: s.id,
      number: 1,
      status: 'SENT',
      saleCurrency: 'EUR',
      participants: 10,
      chaperones: 0,
      staff: 0,
      createdById: owner.id,
      lines: {
        create: {
          position: 0,
          category: 'PER_PARTICIPANT',
          description: 'Costo B',
          quantity: 1,
          unitCost: 777,
          currency: 'EUR',
        },
      },
    },
  });
  const content = Buffer.from('%PDF-1.4 b');
  const a = await prisma.requestAttachment.create({
    data: {
      requestId: r.id,
      fileName: 'b.pdf',
      mimeType: 'application/pdf',
      size: content.length,
      content,
      uploadedById: owner.id,
    },
  });
  Object.assign(b, { request: r.id, version: v.id, scenario: s.id, attachment: a.id });
});
afterAll(() => ctx.app.close());

const call = (
  cookie: string,
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  body?: object,
) => {
  const req = ctx.http()[method](`/api/v1${path}`).set('Cookie', cookie);
  return body ? req.send(body) : req;
};

describe('office isolation (IDOR/BOLA sweep)', () => {
  const byId = () =>
    [
      ['get', `/requests/${b.request}`],
      ['get', `/requests/${b.request}/timeline`],
      ['get', `/requests/${b.request}/scenarios`],
      ['get', `/requests/${b.request}/proposals`],
      ['get', `/requests/${b.request}/team`],
      ['get', `/requests/${b.request}/attachments`],
      ['get', `/requests/${b.request}/attachments/${b.attachment}`],
      ['get', `/requests/${b.request}/wetravel/payments`],
      ['get', `/quotes/${b.version}`],
      ['get', `/quotes/${b.version}/proposal`],
      ['get', `/quotes/${b.version}/compare`],
      ['get', `/quotes/${b.version}/export.xlsx`],
      ['get', `/quotes/${b.version}/shares`],
      ['patch', `/requests/${b.request}`, { groupName: 'x', version: 1 }],
      ['post', `/requests/${b.request}/comments`, { body: 'hola' }],
      ['post', `/requests/${b.request}/assign`, { assigneeId: b.request, version: 1 }],
      ['post', `/requests/${b.request}/cancel`, { reason: 'x', version: 1 }],
      ['post', `/requests/${b.request}/outcome`, { outcome: 'LOST', reason: 'x', version: 1 }],
      ['post', `/requests/${b.request}/payment-reminder`],
      ['post', `/requests/${b.request}/scenarios`, { name: 'x', saleCurrency: 'EUR' }],
      ['post', `/scenarios/${b.scenario}/duplicate`, {}],
      ['post', `/scenarios/${b.scenario}/versions`, {}],
      ['patch', `/quotes/${b.version}`, { rowVersion: 1, targetMarginRate: '0.5' }],
      ['post', `/quotes/${b.version}/approve`, { rowVersion: 1 }],
      [
        'post',
        `/quotes/${b.version}/send`,
        { rowVersion: 1, recipients: 'x', channel: 'OTHER', sentOn: '2026-11-01' },
      ],
      ['post', `/quotes/${b.version}/shares`, { days: 7 }],
      ['post', `/quotes/${b.version}/template`, { name: 'x' }],
      ['post', `/quotes/${b.version}/wetravel`],
      ['put', `/requests/${b.request}/team`, { commercialExecutiveId: null, supportIds: [] }],
    ] as ['get' | 'post' | 'patch' | 'put', string, object?][];

  it('control: the routes exist and answer the office-B coordinator', async () => {
    const adminB = await makeUser([{ officeId: officeB, role: 'OFFICE_ADMIN' }]);
    const c = (await loginAs(ctx, adminB.email)).cookie!;
    const reads = byId().filter(([m, p]) => m === 'get' && !p.includes('wetravel'));
    const statuses = await Promise.all(
      reads.map(async ([, p]) => `${p} ${(await call(c, 'get', p)).status}`),
    );
    expect(statuses.filter((x) => !x.endsWith(' 200'))).toEqual([]);
  });

  for (const role of ROLES)
    it(`${role} of office A gets 403/404 on every office-B record`, async () => {
      const leaks: string[] = [];
      for (const [method, path, body] of byId()) {
        const res = await call(cookieA[role]!, method, path, body);
        if (![400, 403, 404].includes(res.status) || JSON.stringify(res.body).includes('Secreto'))
          leaks.push(`${method.toUpperCase()} ${path} → ${res.status}`);
      }
      expect(leaks).toEqual([]);
      // Nothing changed in B.
      expect(await prisma.travelRequest.findUniqueOrThrow({ where: { id: b.request } })).toMatchObject({
        status: 'SENT',
        groupName: 'Secreto de la oficina B',
      });
    });

  for (const role of ROLES)
    it(`${role} of office A never sees office B in lists, dashboards or reports`, async () => {
      const c = cookieA[role]!;
      const paths = [
        '/requests',
        `/requests?officeId=${officeB}`,
        '/dashboard',
        `/dashboard/executive?officeId=${officeB}`,
        '/dashboard/executive',
        '/schools',
        `/audit-logs?officeId=${officeB}`,
        `/audit-logs?entityId=${b.request}`,
        `/audit-logs/export.csv?officeId=${officeB}`,
        `/reports/financial.xlsx?officeId=${officeB}`,
        `/offices/${officeB}/quoters`,
        `/offices/${officeB}/quote-templates`,
      ];
      const leaks: string[] = [];
      for (const p of paths) {
        const res = await call(c, 'get', p);
        const text = res.text ?? '';
        if (res.status < 300 && (text.includes('Secreto') || text.includes(b.request)))
          leaks.push(`${p} → ${res.status}`);
      }
      expect(leaks).toEqual([]);
    });
});

describe('role limits inside the own office', () => {
  it('only system admins import history or read integrations', async () => {
    for (const role of ROLES) {
      await call(cookieA[role]!, 'post', '/history/preview', {
        fileName: 'a.xlsx',
        fileBase64: 'AA==',
      }).expect(403);
      await call(cookieA[role]!, 'get', '/integrations').expect(403);
      await call(cookieA[role]!, 'put', '/settings/alerts', {}).expect((r) => {
        if (r.status < 400) throw new Error(`${role} changed alert settings`);
      });
    }
  });
});

describe('inactivity lock', () => {
  it('closes a session idle longer than SESSION_IDLE_MINUTES and keeps an active one alive', async () => {
    const idle = await makeApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      testEnv({ SESSION_IDLE_MINUTES: '30' }),
    );
    try {
      const u = await makeUser([{ officeId: officeA, role: 'ADVISOR' }]);
      const cookie = (await loginAs(idle, u.email)).cookie!;
      await idle.http().get('/api/v1/me').set('Cookie', cookie).expect(200);

      // 20 minutes idle: still in, and the request refreshes the clock.
      await prisma.session.updateMany({
        where: { userId: u.id },
        data: { lastSeenAt: new Date(Date.now() - 20 * 60_000) },
      });
      await idle.http().get('/api/v1/me').set('Cookie', cookie).expect(200);
      const seen = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
      expect(Date.now() - seen.lastSeenAt.getTime()).toBeLessThan(60_000);

      // 31 minutes idle: out, with a code the web turns into a clear message, and the session is gone.
      await prisma.session.updateMany({
        where: { userId: u.id },
        data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) },
      });
      const res = await idle.http().get('/api/v1/me').set('Cookie', cookie).expect(401);
      expect(res.body.code).toBe('SESSION_EXPIRED');
      expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
      expect((await idle.http().get('/api/v1/me').expect(401)).body.code).not.toBe('SESSION_EXPIRED');
    } finally {
      await idle.app.close();
    }
  });
});
