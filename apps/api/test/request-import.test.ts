import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SheetKind, SheetReader } from '../src/quotes/sheet-import.js';
import { FakeOidc, loginAs, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

class FakeReader implements SheetReader {
  kinds: (SheetKind | undefined)[] = [];
  texts: string[] = [];
  answer: unknown = {
    groupName: 'Inmersión Boston & MIT',
    clientName: 'Colegio Altamira',
    program: 'STEM y robótica',
    city: 'Boston',
    countryCode: 'us',
    departureDate: '2027-06-20',
    returnDate: '2027-07-04',
    participants: 25,
    chaperones: 2,
    staff: 1,
    requirements: 'Visita al MIT',
    warnings: [],
  };
  async read(text: string, kind?: SheetKind) {
    this.texts.push(text);
    this.kinds.push(kind);
    return this.answer;
  }
}

let ctx: Awaited<ReturnType<typeof makeApp>>;
let off: Awaited<ReturnType<typeof makeApp>>;
const reader = new FakeReader();
const c: Record<'advisor' | 'quoter', string> = {} as never;
let advisorId: string;
let xlsx: string;

const upload = (cookie: string, body: object = { fileName: 'ficha.xlsx', fileBase64: xlsx }, app = ctx) =>
  app.http().post('/api/v1/requests/import').set('Cookie', cookie).send(body);

beforeAll(async () => {
  ctx = await makeApp(new FakeOidc(), reader);
  off = await makeApp();
  const officeId = (await makeOffice()).id;
  const advisor = await makeUser([{ officeId, role: 'ADVISOR' }]);
  const quoter = await makeUser([{ officeId, role: 'QUOTER' }]);
  advisorId = advisor.id;
  c.advisor = (await loginAs(ctx, advisor.email)).cookie!;
  c.quoter = (await loginAs(ctx, quoter.email)).cookie!;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ficha');
  ws.addRow(['Colegio', 'Colegio Altamira']);
  ws.addRow(['Destino', 'Boston']);
  xlsx = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
});
afterAll(async () => {
  await ctx.app.close();
  await off.app.close();
  await prisma.$disconnect();
});

describe('new request from a sheet', () => {
  it('proposes the form fields from the sheet, without saving a request', async () => {
    const before = await prisma.travelRequest.count({ where: { requesterId: advisorId } });
    const res = await upload(c.advisor).expect(201);
    expect(res.body.draft).toEqual({
      groupName: 'Inmersión Boston & MIT',
      clientName: 'Colegio Altamira',
      program: 'STEM y robótica',
      city: 'Boston',
      countryCode: 'US',
      departureDate: '2027-06-20',
      returnDate: '2027-07-04',
      participants: 25,
      chaperones: 2,
      staff: 1,
      requirements: 'Visita al MIT',
    });
    expect(reader.kinds.at(-1)).toBe('request');
    expect(reader.texts.at(-1)).toContain('A1: Colegio');
    expect(await prisma.travelRequest.count({ where: { requesterId: advisorId } })).toBe(before);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'request.import_previewed', actorUserId: advisorId },
    });
    expect(JSON.stringify(log.diff)).not.toContain('Altamira'); // field names only, never values
  });

  it('drops invalid values with a warning instead of trusting the model', async () => {
    reader.answer = {
      groupName: 'Viaje',
      countryCode: 'Narnia',
      departureDate: '2027-07-10',
      returnDate: '2027-07-01',
      participants: -3,
      warnings: ['No encontré el número de chaperones'],
    };
    const res = await upload(c.advisor).expect(201);
    expect(res.body.draft).toEqual({ groupName: 'Viaje', departureDate: '2027-07-10' });
    expect(res.body.warnings).toHaveLength(4);
  });

  it('refuses roles that cannot create, bad files, and works only when the AI is configured', async () => {
    await upload(c.quoter).expect(403);
    await upload(c.advisor, { fileName: 'ficha.pdf', fileBase64: xlsx }).expect(400);
    await upload(c.advisor, { sheetUrl: 'https://evil.example/x' }).expect(400);
    await upload(c.advisor, {}).expect(400);
    const offCookie = (
      await loginAs(off, (await prisma.user.findUniqueOrThrow({ where: { id: advisorId } })).email)
    ).cookie!;
    await upload(offCookie, undefined, off).expect(503);
    await ctx
      .http()
      .post('/api/v1/requests/import')
      .send({ fileName: 'a.xlsx', fileBase64: xlsx })
      .expect(401);
  });
});
