import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_APPROVAL_RULES } from '@ee/contracts';
import { autoApproval, full, needsTwoLevels } from '../src/quotes/quotes.controller.js';
import { loginAs, makeApp, makeOffice, makeUser, prisma, uniq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<string, string> = {};
let versionId: string;

beforeAll(async () => {
  ctx = await makeApp();
  const officeId = (await makeOffice()).id;
  const sys = await makeUser([{ officeId, role: 'SYSTEM_ADMIN' }]);
  const approver = await makeUser([{ officeId, role: 'APPROVER' }]);
  c.sys = (await loginAs(ctx, sys.email)).cookie!;
  c.approver = (await loginAs(ctx, approver.email)).cookie!;
  const r = await prisma.travelRequest.create({
    data: {
      folio: `EE-2027-${uniq().toUpperCase()}`,
      officeId,
      requesterId: sys.id,
      status: 'QUOTING',
      groupName: 'Reglas',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: new Date('2027-03-19'),
      returnDate: new Date('2027-03-25'),
      participants: 10,
    },
  });
  const sc = await prisma.quoteScenario.create({ data: { requestId: r.id, name: 'A', createdById: sys.id } });
  // 10 students × 1,000 MXN at 20% over price → 12,500 MXN for the group.
  versionId = (
    await prisma.quoteVersion.create({
      data: {
        scenarioId: sc.id,
        number: 1,
        saleCurrency: 'MXN',
        targetMarginRate: '0.2',
        participants: 10,
        chaperones: 0,
        staff: 0,
        createdById: sys.id,
        lines: {
          create: [
            {
              position: 0,
              category: 'PER_PARTICIPANT',
              description: 'Hotel',
              quantity: 1,
              unitCost: 1000,
              currency: 'MXN',
            },
          ],
        },
      },
    })
  ).id;
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

const version = () => prisma.quoteVersion.findUniqueOrThrow({ where: { id: versionId }, include: full });
const rules = (patch: Partial<typeof DEFAULT_APPROVAL_RULES>) => ({ ...DEFAULT_APPROVAL_RULES, ...patch });

describe('authorization rules', () => {
  it('auto-approves only inside both limits, and says why', async () => {
    const v = await version();
    expect(autoApproval(rules({ autoApprove: false }), v)).toBeNull();
    expect(
      autoApproval(rules({ autoApprove: true, autoMinMarginRate: '0.15', autoMaxGroupMxn: '50000' }), v),
    ).toBe('Autorizada por regla: margen 20% ≥ 15% y total 12500.00 MXN ≤ 50000.00 MXN');
    expect(autoApproval(rules({ autoApprove: true, autoMinMarginRate: '0.25' }), v)).toBeNull();
    expect(autoApproval(rules({ autoApprove: true, autoMaxGroupMxn: '10000' }), v)).toBeNull();
  });

  it('a version in another currency without its MXN rate never auto-approves', async () => {
    const base = await version();
    const fx = {
      id: 'x',
      versionId,
      fromCurrency: 'MXN',
      toCurrency: 'EUR',
      rate: '0.05',
      rateDate: new Date(),
      source: 't',
      capturedById: 'x',
      createdAt: new Date(),
    };
    const v = {
      ...base,
      saleCurrency: 'EUR',
      mxnRate: null,
      fxRates: [fx as unknown as (typeof base.fxRates)[number]],
    };
    expect(
      autoApproval(rules({ autoApprove: true, autoMinMarginRate: '0', autoMaxGroupMxn: '999999999' }), v),
    ).toBeNull();
  });

  it('asks for two approvers only below the margin', async () => {
    const v = await version();
    expect(needsTwoLevels(rules({ twoLevelBelowMarginRate: null }), v)).toBe(false);
    expect(needsTwoLevels(rules({ twoLevelBelowMarginRate: '0.25' }), v)).toBe(true);
    expect(needsTwoLevels(rules({ twoLevelBelowMarginRate: '0.15' }), v)).toBe(false);
  });

  it('only a system admin edits the rules; values are validated and audited', async () => {
    const put = (cookie: string, body: object) =>
      ctx.http().put('/api/v1/settings/approval-rules').set('Cookie', cookie).send(body);
    await put(c.approver!, DEFAULT_APPROVAL_RULES).expect(403);
    await put(c.sys!, { ...DEFAULT_APPROVAL_RULES, autoMinMarginRate: '1.5' }).expect(400);
    // Defaults only: other test files submit quotes in parallel against the same global rules.
    await put(c.sys!, DEFAULT_APPROVAL_RULES).expect(200);
    expect(
      (await ctx.http().get('/api/v1/settings/approval-rules').set('Cookie', c.approver!).expect(200)).body,
    ).toEqual(DEFAULT_APPROVAL_RULES);
    await prisma.auditLog.findFirstOrThrow({ where: { action: 'settings.approvalRules.updated' } });
  });
});
