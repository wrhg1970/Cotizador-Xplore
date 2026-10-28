import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, makeAgency, makeApp, makeOffice, makeUser, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let admin: string;
let coordinator: string;
let office: { id: string; name: string };

/** Same layout as Finance's workbooks ("Consolidado" + "Opción N"), with made-up figures. */
async function eeWorkbook(officeName: string) {
  const wb = new ExcelJS.Workbook();
  const c = wb.addWorksheet('Consolidado');
  c.getCell('B2').value = 'Nombre Grupo';
  c.getCell('C2').value = 'PRUEBA ROMA 2025';
  c.getCell('B3').value = 'Organización';
  c.getCell('C3').value = 'PROVEEDOR X';
  c.getCell('B4').value = 'Oficina';
  c.getCell('C4').value = officeName.toUpperCase();
  c.getCell('B5').value = 'País destino';
  c.getCell('C5').value = 'ITALIA';
  c.getCell('E5').value = 'Ciudad destino';
  c.getCell('F5').value = 'Roma';
  c.getCell('B6').value = 'Cliente';
  c.getCell('C6').value = 'Colegio de Prueba';
  c.getCell('B8').value = 'Fecha Salida';
  c.getCell('C8').value = new Date('2025-03-10T00:00:00Z');
  c.getCell('B9').value = 'Fecha Regreso';
  c.getCell('C9').value = new Date('2025-03-20T00:00:00Z');
  c.getCell('E9').value = 'Chaperones';
  c.getCell('E10').value = 'EE';
  c.getCell('F10').value = 2;
  for (const [name, participants, rate, price] of [
    ['Opción 1', 10, 0.18, 2000],
    ['Opcion 2', 20, 0.2, { formula: '1500+300', result: 1800 }],
  ] as const) {
    const o = wb.addWorksheet(name);
    o.getCell('B6').value = 'Divisa';
    o.getCell('C6').value = 'EURO';
    o.getCell('D6').value = 20.5;
    o.getCell('F6').value = 'Participantes';
    o.getCell('G6').value = participants;
    o.getCell('C24').value = '% Comisión';
    o.getCell('D24').value = rate;
    o.getCell('B26').value = 'PRECIO FINAL';
    o.getCell('C26').value = 'PRECIO FINAL';
    o.getCell('D26').value = price as ExcelJS.CellValue;
  }
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

beforeAll(async () => {
  ctx = await makeApp();
  office = await prisma.office.update({
    where: { id: (await makeOffice()).id },
    data: { name: `Histórico Monterrey ${Date.now()}` },
  });
  const a = await makeUser([{ officeId: office.id, role: 'SYSTEM_ADMIN' }]);
  const b = await makeUser([{ officeId: office.id, role: 'OFFICE_ADMIN' }]);
  admin = (await loginAs(ctx, a.email)).cookie!;
  coordinator = (await loginAs(ctx, b.email)).cookie!;
});
afterAll(() => ctx.app.close());

const preview = (cookie: string, fileBase64: string) =>
  ctx
    .http()
    .post('/api/v1/history/preview')
    .set('Cookie', cookie)
    .send({ fileName: 'roma.xlsx', fileBase64 });

describe('historic import', () => {
  it('reads an EE workbook by its labels and matches the office', async () => {
    const res = await preview(admin, await eeWorkbook(office.name)).expect(201);
    expect(res.body).toMatchObject({
      groupName: 'PRUEBA ROMA 2025',
      clientName: 'Colegio de Prueba',
      city: 'Roma',
      countryCode: 'IT',
      departureDate: '2025-03-10',
      returnDate: '2025-03-20',
      staff: 2,
      officeId: office.id,
      warnings: [],
    });
    expect(res.body.options).toEqual([
      {
        name: 'Opción 1',
        saleCurrency: 'EUR',
        mxnRate: '20.500000',
        participants: 10,
        targetMarginRate: '0.180000',
        pricePerParticipant: '2000.00',
      },
      {
        name: 'Opcion 2',
        saleCurrency: 'EUR',
        mxnRate: '20.500000',
        participants: 20,
        targetMarginRate: '0.200000',
        pricePerParticipant: '1800.00',
      },
    ]);
  });

  it('creates a won request with its options sent, keeps the sheet price and refuses a duplicate', async () => {
    const p = (await preview(admin, await eeWorkbook(office.name))).body;
    const body = {
      officeId: office.id,
      sourceFile: 'roma.xlsx',
      groupName: p.groupName,
      clientName: p.clientName,
      program: p.program,
      city: p.city,
      countryCode: p.countryCode,
      departureDate: p.departureDate,
      returnDate: p.returnDate,
      staff: p.staff,
      options: p.options,
      outcome: 'WON',
      wonOption: 1,
      sentOn: '2025-01-15',
    };
    const res = await ctx.http().post('/api/v1/history').set('Cookie', admin).send(body).expect(201);
    expect(res.body.folio).toMatch(/^EE-2025-/);

    const r = await prisma.travelRequest.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { scenarios: { include: { versions: { include: { reviews: true, deliveries: true } } } } },
    });
    expect(r).toMatchObject({ status: 'WON', participants: 20, closedAt: new Date('2025-01-15T00:00:00Z') });
    expect(r.createdAt.toISOString().slice(0, 10)).toBe('2025-01-15');
    const versions = r.scenarios.flatMap((s) => s.versions);
    expect(versions.map((v) => v.status)).toEqual(['SENT', 'SENT']);
    expect(versions.every((v) => v.reviews[0]?.decision === 'APPROVED' && v.deliveries.length === 1)).toBe(
      true,
    );
    expect(r.wonVersionId).toBe(r.scenarios.find((s) => s.name === 'Opcion 2')!.versions[0]!.id);

    // The app's own engine reproduces the sheet's final price (rounded up to the peso/euro).
    const q = await ctx.http().get(`/api/v1/quotes/${r.wonVersionId}`).set('Cookie', admin).expect(200);
    expect(Number(q.body.totals.pricePerParticipant)).toBeGreaterThanOrEqual(1800);
    expect(Number(q.body.totals.pricePerParticipant)).toBeLessThan(1801);

    const log = await prisma.auditLog.findFirst({
      where: { entityId: r.id, action: 'request.history_imported' },
    });
    expect(log?.diff).toMatchObject({ outcome: 'WON', options: 2 });

    const again = await ctx.http().post('/api/v1/history').set('Cookie', admin).send(body).expect(409);
    expect(again.body.message).toContain(res.body.folio);
  });

  it('requires a reason when lost and is closed to anyone but the system admin', async () => {
    const p = (await preview(admin, await eeWorkbook(office.name))).body;
    const base = {
      ...p,
      officeId: office.id,
      sourceFile: 'x.xlsx',
      sentOn: '2025-02-01',
      groupName: 'Otro grupo',
    };
    delete base.officeName;
    delete base.warnings;
    await ctx
      .http()
      .post('/api/v1/history')
      .set('Cookie', admin)
      .send({ ...base, outcome: 'LOST' })
      .expect(400);
    await ctx
      .http()
      .post('/api/v1/history')
      .set('Cookie', admin)
      .send({ ...base, outcome: 'LOST', lostReason: 'Precio' })
      .expect(201);
    await preview(coordinator, await eeWorkbook(office.name)).expect(403);
    await ctx
      .http()
      .post('/api/v1/history')
      .set('Cookie', coordinator)
      .send({ ...base, outcome: 'SENT' })
      .expect(403);
  });

  it("never matches nor imports into another agency's office", async () => {
    const other = await makeOffice((await makeAgency()).id);
    const p = (await preview(admin, await eeWorkbook(other.name))).body;
    expect(p.officeId).not.toBe(other.id);
    const { officeName: _n, warnings: _w, ...sheet } = p;
    await ctx
      .http()
      .post('/api/v1/history')
      .set('Cookie', admin)
      .send({ ...sheet, officeId: other.id, sourceFile: 'x.xlsx', sentOn: '2025-02-01', outcome: 'SENT' })
      .expect(404);
  });

  it('explains a file that is not an EE workbook', async () => {
    const res = await preview(admin, Buffer.from('hola').toString('base64')).expect(400);
    expect(res.body.message).toBe('El archivo no es un Excel válido');
  });
});
