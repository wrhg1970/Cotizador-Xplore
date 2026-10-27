import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SheetReader } from '../src/quotes/sheet-import.js';
import { FakeOidc, loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

class FakeReader implements SheetReader {
  calls: string[] = [];
  answer: unknown = {
    summary: 'Una opción en EUR',
    lines: [
      {
        category: 'PER_PARTICIPANT',
        description: 'Precio neto',
        quantity: '1',
        unitCost: '3900',
        currency: 'EUR',
        internalOnly: false,
      },
    ],
    targetMarginRate: '0.18',
    warnings: [],
  };
  fail = false;
  async read(text: string) {
    this.calls.push(text);
    if (this.fail) throw new Error('quota exceeded: <prompt echoed here>');
    return this.answer;
  }
}

let ctx: Awaited<ReturnType<typeof makeApp>>;
let off: Awaited<ReturnType<typeof makeApp>>;
const reader = new FakeReader();
const c: Record<'quoter' | 'quoter2' | 'adminB', string> = {} as never;
let quoteId: string;
let xlsx: string;
let quoterEmail: string;

const upload = (cookie: string, body: object = { fileName: 'costos.xlsx', fileBase64: xlsx }, id = quoteId) =>
  ctx.http().post(`/api/v1/quotes/${id}/import`).set('Cookie', cookie).send(body);

beforeAll(async () => {
  ctx = await makeApp(new FakeOidc(), reader);
  off = await makeApp();
  const officeA = (await makeOffice()).id;
  const officeB = (await makeOffice()).id;
  const users = {
    advisor: await makeUser([{ officeId: officeA, role: 'ADVISOR' }]),
    quoter: await makeUser([{ officeId: officeA, role: 'QUOTER' }]),
    quoter2: await makeUser([{ officeId: officeA, role: 'QUOTER' }]),
    adminA: await makeUser([{ officeId: officeA, role: 'OFFICE_ADMIN' }]),
    adminB: await makeUser([{ officeId: officeB, role: 'OFFICE_ADMIN' }]),
  };
  quoterEmail = users.quoter.email;
  const cookie = async (u: { email: string }) => (await loginAs(ctx, u.email)).cookie!;
  c.quoter = await cookie(users.quoter);
  c.quoter2 = await cookie(users.quoter2);
  c.adminB = await cookie(users.adminB);
  const advisor = await cookie(users.advisor);
  const adminA = await cookie(users.adminA);

  const id = (
    await ctx
      .http()
      .post('/api/v1/requests')
      .set('Cookie', advisor)
      .send({
        officeId: officeA,
        groupName: 'Roma 2027',
        city: 'Roma',
        countryCode: 'IT',
        departureDate: '2027-03-19',
        returnDate: '2027-03-25',
        participants: 10,
      })
      .expect(201)
  ).body.id;
  await ctx
    .http()
    .post(`/api/v1/requests/${id}/submit`)
    .set('Cookie', advisor)
    .send({ version: 1 })
    .expect(201);
  await ctx
    .http()
    .post(`/api/v1/requests/${id}/assign`)
    .set('Cookie', adminA)
    .send({ assigneeId: users.quoter.id, version: 2 })
    .expect(201);
  quoteId = (
    await ctx
      .http()
      .post(`/api/v1/requests/${id}/scenarios`)
      .set('Cookie', c.quoter)
      .send({ name: 'Opción 1', saleCurrency: 'EUR' })
      .expect(201)
  ).body.latest.id;

  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Costos').addRows([
    ['Concepto', 'EUR'],
    ['Precio neto', 3900],
  ]);
  xlsx = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
});
afterAll(async () => {
  await ctx.app.close();
  await off.app.close();
  await prisma.$disconnect();
});

describe('sheet importer (Sprint C)', () => {
  it('returns a validated proposal without saving anything, and audits only counts', async () => {
    const before = await prisma.quoteLine.count({ where: { versionId: quoteId } });
    const res = await upload(c.quoter).expect(201);
    expect(res.body).toMatchObject({
      summary: 'Una opción en EUR',
      lines: [{ description: 'Precio neto', unitCost: '3900', currency: 'EUR', category: 'PER_PARTICIPANT' }],
      targetMarginRate: '0.18',
    });
    expect(reader.calls.at(-1)).toContain('A2: Precio neto | B2: 3900');
    expect(await prisma.quoteLine.count({ where: { versionId: quoteId } })).toBe(before);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'quote.import_previewed', entityId: quoteId },
    });
    expect(log.diff).toEqual({ source: 'xlsx', lines: 1, warnings: 0 });
  });

  it('only the assignee works on it; other offices do not see it', async () => {
    await upload(c.quoter2).expect(403);
    await upload(c.adminB).expect(404);
  });

  it('validates the input before calling the model', async () => {
    const calls = reader.calls.length;
    await upload(c.quoter, { fileName: 'costos.pdf', fileBase64: xlsx }).expect(400);
    await upload(c.quoter, { fileName: 'costos.xlsx', fileBase64: 'bm90IGEgemlw' }).expect(400);
    await upload(c.quoter, { fileBase64: xlsx }).expect(400); // no file name
    await upload(c.quoter, {
      fileName: 'a.xlsx',
      fileBase64: xlsx,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/x',
    }).expect(400);
    const bad = await upload(c.quoter, {
      sheetUrl: 'https://evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz',
    }).expect(400);
    expect(bad.body.message).toContain('Google Sheets');
    expect(reader.calls.length).toBe(calls);
  });

  it('rejects uploads over the size limit', async () => {
    await upload(c.quoter, { fileName: 'big.xlsx', fileBase64: 'A'.repeat(4_300_000) }).expect((r) =>
      expect([400, 413]).toContain(r.status),
    );
  });

  it('answers 502 without leaking provider details when the model fails', async () => {
    reader.fail = true;
    const res = await upload(c.quoter).expect(502);
    expect(JSON.stringify(res.body)).not.toContain('prompt');
    reader.fail = false;
  });

  it('answers 503 when Vertex AI is not configured', async () => {
    const cookie = (await loginAs(off, quoterEmail)).cookie!;
    const res = await off
      .http()
      .post(`/api/v1/quotes/${quoteId}/import`)
      .set('Cookie', cookie)
      .send({ fileName: 'costos.xlsx', fileBase64: xlsx })
      .expect(503);
    expect(res.body.message).toContain('no está configurado');
  });
});
