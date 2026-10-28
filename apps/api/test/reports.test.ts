import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
const c: Record<'advisor' | 'quoter' | 'approver' | 'adminA' | 'adminB' | 'sysadmin', string> = {} as never;
const ids: Record<string, string> = {};
let officeA: string;

const api = () => ctx.http();
const act = (cookie: string, id: string, action: string, body: object) =>
  api().post(`/api/v1/quotes/${id}/${action}`).set('Cookie', cookie).send(body);
const binary = (path: string, cookie: string) =>
  api()
    .get(path)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });

beforeAll(async () => {
  ctx = await makeApp();
  officeA = (await makeOffice()).id;
  const officeB = (await makeOffice()).id;
  const login = async (
    key: keyof typeof c,
    officeId: string,
    role: 'ADVISOR' | 'QUOTER' | 'APPROVER' | 'OFFICE_ADMIN' | 'SYSTEM_ADMIN',
  ) => {
    const u = await makeUser([{ officeId, role }]);
    ids[key] = u.id;
    c[key] = (await loginAs(ctx, u.email)).cookie!;
  };
  await login('advisor', officeA, 'ADVISOR');
  await login('quoter', officeA, 'QUOTER');
  await login('approver', officeA, 'APPROVER');
  await login('adminA', officeA, 'OFFICE_ADMIN');
  await login('adminB', officeB, 'OFFICE_ADMIN');
  await login('sysadmin', officeB, 'SYSTEM_ADMIN');
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

/** A request in office A with one version in review: 10 students × 1000 EUR at 18% → 1220 EUR each. */
async function inReview(groupName: string) {
  const r = (
    await api()
      .post('/api/v1/requests')
      .set('Cookie', c.advisor)
      .send({
        officeId: officeA,
        groupName,
        city: 'Roma',
        countryCode: 'IT',
        departureDate: '2027-03-19',
        returnDate: '2027-03-25',
        participants: 10,
      })
      .expect(201)
  ).body;
  await api()
    .post(`/api/v1/requests/${r.id}/submit`)
    .set('Cookie', c.advisor)
    .send({ version: 1 })
    .expect(201);
  await api()
    .post(`/api/v1/requests/${r.id}/assign`)
    .set('Cookie', c.adminA)
    .send({ assigneeId: ids.quoter, version: 2 })
    .expect(201);
  const v = (
    await api()
      .post(`/api/v1/requests/${r.id}/scenarios`)
      .set('Cookie', c.quoter)
      .send({ name: 'Opción', saleCurrency: 'EUR' })
      .expect(201)
  ).body.latest;
  const ready = (
    await api()
      .patch(`/api/v1/quotes/${v.id}`)
      .set('Cookie', c.quoter)
      .send({
        targetMarginRate: '0.18',
        validUntil: '2026-12-31',
        rowVersion: 1,
        lines: [
          {
            category: 'PER_PARTICIPANT',
            description: 'Precio neto',
            quantity: '1',
            unitCost: '1000',
            currency: 'EUR',
          },
        ],
      })
      .expect(200)
  ).body;
  const s = (await act(c.quoter, v.id, 'submit', { rowVersion: ready.rowVersion }).expect(201)).body;
  return { requestId: r.id as string, versionId: v.id as string, rowVersion: s.rowVersion as number };
}

async function won(groupName: string) {
  const q = await inReview(groupName);
  const a = (await act(c.approver, q.versionId, 'approve', { rowVersion: q.rowVersion }).expect(201)).body;
  await act(c.quoter, q.versionId, 'send', {
    recipients: 'direccion@colegio.example',
    channel: 'EMAIL',
    sentOn: '2026-10-28',
    rowVersion: a.rowVersion,
  }).expect(201);
  const r = (await api().get(`/api/v1/requests/${q.requestId}`).set('Cookie', c.quoter).expect(200)).body;
  await api()
    .post(`/api/v1/requests/${q.requestId}/outcome`)
    .set('Cookie', c.quoter)
    .send({ outcome: 'WON', versionId: q.versionId, version: r.version })
    .expect(201);
  return q;
}

describe('global approvals and sent proposals', () => {
  it('lists versions in review across the office, with client price only and who may approve', async () => {
    const q = await inReview('Pendiente de autorizar');
    const list = async (cookie: string, status = 'IN_REVIEW') =>
      (await api().get(`/api/v1/reports/versions?status=${status}`).set('Cookie', cookie).expect(200))
        .body as {
        id: string;
        price: string;
        canApprove: boolean;
      }[];
    const forApprover = (await list(c.approver)).find((v) => v.id === q.versionId);
    expect(forApprover).toMatchObject({ price: '1220.00', canApprove: true, request: { status: 'QUOTING' } });
    expect(JSON.stringify(forApprover)).not.toMatch(/cost|recipients/i);
    const forAdvisor = (await list(c.advisor)).find((v) => v.id === q.versionId);
    expect(JSON.stringify(forAdvisor)).not.toMatch(/cost|margin|recipients/i); // no cost view
    expect((await list(c.quoter)).find((v) => v.id === q.versionId)?.canApprove).toBe(false); // own work
    expect((await list(c.advisor)).find((v) => v.id === q.versionId)?.canApprove).toBe(false);
    expect((await list(c.adminB)).some((v) => v.id === q.versionId)).toBe(false); // other office
    expect((await list(c.approver, 'SENT')).some((v) => v.id === q.versionId)).toBe(false);
    await api().get('/api/v1/reports/versions?status=DRAFT').set('Cookie', c.approver).expect(400);
    const all = async (cookie: string) =>
      (await api().get('/api/v1/reports/versions').set('Cookie', cookie).expect(200)).body as {
        id: string;
        status: string;
      }[];
    expect((await all(c.approver)).find((v) => v.id === q.versionId)?.status).toBe('IN_REVIEW');
    expect((await all(c.adminB)).some((v) => v.id === q.versionId)).toBe(false); // other office
    const draft = (
      await api()
        .post(`/api/v1/requests/${q.requestId}/scenarios`)
        .set('Cookie', c.quoter)
        .send({ name: 'Borrador', saleCurrency: 'EUR' })
        .expect(201)
    ).body.latest as { id: string };
    expect((await all(c.quoter)).find((v) => v.id === draft.id)?.status).toBe('DRAFT');
    expect((await all(c.advisor)).some((v) => v.id === draft.id)).toBe(false); // working copy, no cost view
    await api().get('/api/v1/reports/versions?status=IN_REVIEW').expect(401);
  });

  it('approvals tray: pending and authorized versions with group total, margin and signatures', async () => {
    const pending = await inReview('Bandeja pendiente');
    const done = await inReview('Bandeja aprobada');
    await act(c.approver, done.versionId, 'approve', { rowVersion: done.rowVersion }).expect(201);
    const tray = (
      await api().get('/api/v1/reports/versions?status=APPROVAL').set('Cookie', c.approver).expect(200)
    ).body as { id: string; status: string }[];
    expect(tray.find((v) => v.id === pending.versionId)).toMatchObject({
      status: 'IN_REVIEW',
      scenarioName: 'Opción',
      number: 1,
      participants: 10,
      chaperones: 0,
      groupPrice: '12200.00',
      marginRate: '0.1803',
      signatures: 0,
      request: { groupName: 'Bandeja pendiente' },
    });
    expect(tray.find((v) => v.id === done.versionId)).toMatchObject({ status: 'APPROVED', signatures: 1 });
    const advisorTray = (
      await api().get('/api/v1/reports/versions?status=APPROVAL').set('Cookie', c.advisor).expect(200)
    ).body as { id: string }[];
    expect(advisorTray.find((v) => v.id === pending.versionId)).not.toHaveProperty('marginRate');
  });

  it('committee page: policy per scenario, reject goes back to the quoter and is audited apart', async () => {
    const q = await inReview('Dictamen');
    const scenarios = (
      await api().get(`/api/v1/requests/${q.requestId}/scenarios`).set('Cookie', c.approver).expect(200)
    ).body as { preparedBy: string; policy: string }[];
    expect(scenarios[0]).toMatchObject({ policy: 'Una firma de «Autorizar viaje»' });
    expect(scenarios[0]!.preparedBy).toBeTruthy();
    await act(c.quoter, q.versionId, 'return', {
      rowVersion: q.rowVersion,
      comment: 'No',
      reject: true,
    }).expect(403); // own work
    const r = (
      await act(c.approver, q.versionId, 'return', {
        rowVersion: q.rowVersion,
        comment: 'Margen insuficiente',
        reject: true,
      }).expect(201)
    ).body as { status: string; reviews: { decision: string; comment: string }[] };
    expect(r.status).toBe('RETURNED');
    expect(r.reviews.at(-1)).toMatchObject({
      decision: 'RETURNED',
      comment: 'Rechazada: Margen insuficiente',
    });
    expect(await prisma.auditLog.count({ where: { action: 'quote.rejected', entityId: q.versionId } })).toBe(
      1,
    );
  });

  it('lists sent proposals with the delivery date and channel', async () => {
    const q = await won('Ya enviada');
    const list = (
      await api().get('/api/v1/reports/versions?status=SENT').set('Cookie', c.advisor).expect(200)
    ).body as { id: string }[];
    expect(list.find((v) => v.id === q.versionId)).toMatchObject({
      sentOn: '2026-10-28',
      channel: 'EMAIL',
      request: { status: 'WON' },
    });
  });
});

describe('financial report', () => {
  it('exports won trips with cost and commission, audited, only for roles that may export', async () => {
    const q = await won('Reporte financiero');
    const path = `/api/v1/reports/financial.xlsx?officeId=${officeA}&from=2027-01-01&to=2027-12-31`;
    await binary(path, c.advisor).expect(403); // advisors have no internal export by default
    await binary(path, c.adminB).expect(403); // other office
    await binary('/api/v1/reports/financial.xlsx?from=2027-12-31&to=2027-01-01', c.quoter).expect(400);
    const res = await binary(path, c.quoter).expect(200);
    expect(res.headers['content-disposition']).toContain('reporte-financiero-2027-01-01-2027-12-31.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ExcelJS.Buffer);
    const rows = wb.getWorksheet('Ganadas')!.getSheetValues() as unknown[][];
    const row = rows.find((x) => x?.[3] === 'Reporte financiero')!;
    // [folio, office, group, departure, proposal, students, currency, price, sale, cost, commission, %]
    expect(row.slice(6)).toEqual([10, 'EUR', 1220, 12200, 10000, 2200, 0.1803]);
    expect(
      await prisma.auditLog.count({
        where: { action: 'report.financial_exported', actorUserId: ids.quoter },
      }),
    ).toBe(1);
    // Other periods leave the trip out.
    const other = await binary(
      `/api/v1/reports/financial.xlsx?officeId=${officeA}&from=2028-01-01`,
      c.quoter,
    );
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(other.body as ExcelJS.Buffer);
    expect(JSON.stringify(wb2.getWorksheet('Ganadas')!.getSheetValues())).not.toContain(q.requestId);
    expect(JSON.stringify(wb2.getWorksheet('Ganadas')!.getSheetValues())).not.toContain('Reporte financiero');
  });
});

describe('integrations status', () => {
  it('only the system admin sees which connectors are configured, never the secrets', async () => {
    await api().get('/api/v1/integrations').set('Cookie', c.adminA).expect(403);
    const res = (await api().get('/api/v1/integrations').set('Cookie', c.sysadmin).expect(200)).body as {
      key: string;
      configured: boolean;
    }[];
    expect(res.map((i) => i.key)).toEqual([
      'GOOGLE',
      'MAIL',
      'VERTEX',
      'WETRAVEL',
      'BANXICO',
      'CRON',
      'WISSIFY',
    ]);
    expect(res.find((i) => i.key === 'WISSIFY')?.configured).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/secret|password|key"\s*:\s*"[^A-Z]/i);
  });
});
