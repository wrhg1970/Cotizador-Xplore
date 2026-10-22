import ExcelJS from 'exceljs';
import type { QuoteDto } from './quotes.controller.js';

const CATEGORY: Record<string, string> = {
  PER_PARTICIPANT: 'Por estudiante',
  PER_CHAPERONE: 'Por chaperón de la escuela',
  PER_STAFF: 'Por chaperón EE',
  PER_GROUP: 'Fijo del grupo',
  CONTINGENCY: 'Fondo de emergencia',
};
const STATUS: Record<string, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  RETURNED: 'Devuelta',
  APPROVED: 'Autorizada',
  SENT: 'Enviada',
  SUPERSEDED: 'Reemplazada',
};
// Money stays a decimal string in the app; Excel needs numbers to sum, 2–4 decimals fit a double exactly enough.
const num = (s: string | null | undefined) => (s == null ? null : Number(s));

/** Internal workbook for Finance: inputs, per-line totals and the summary the app shows. */
export async function quoteWorkbook(q: QuoteDto, req: { folio: string; groupName: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cotización');
  const cur = q.saleCurrency;
  const t = q.totals;

  ws.addRows([
    ['USO INTERNO: contiene costes y margen'],
    [],
    ['Folio', req.folio],
    ['Grupo', req.groupName],
    ['Escenario', `${q.scenarioName} · v${q.number}`],
    ['Estado', STATUS[q.status] ?? q.status],
    ['Moneda de venta', cur],
    ['Estudiantes', q.participants],
    ['Chaperones de la escuela', q.chaperones],
    ['Chaperones EE', q.staff],
    ['% margen sobre precio final', num(q.targetMarginRate)],
    ['Vigencia', q.validUntil],
    ['Tipo de cambio a MXN', num(q.mxnRate)],
    [],
  ]);
  ws.getCell('A1').font = { bold: true, color: { argb: 'FFB42318' } };
  ws.getCell('B11').numFmt = '0.00%';

  const header = ws.addRow([
    'Tipo',
    'Concepto',
    'Cantidad',
    'Costo unitario',
    'Moneda',
    `Total en ${cur}`,
    'Solo interno',
    'Fuente del costo',
  ]);
  header.font = { bold: true };
  q.lines.forEach((l, i) =>
    ws.addRow([
      CATEGORY[l.category] ?? l.category,
      l.description,
      num(l.quantity),
      num(l.unitCost),
      l.currency,
      num(t?.lineTotals[i]),
      l.internalOnly ? 'Sí' : 'No',
      l.costSource ?? '',
    ]),
  );

  ws.addRow([]);
  const summary: [string, string | null | undefined, string][] = [
    ['Conceptos por estudiante', t?.directPerParticipant, cur],
    ['Gastos del líder y fijos ÷ estudiantes', t?.sharedPerParticipant, cur],
    ['Coste por estudiante', t?.costPerParticipant, cur],
    ['Margen por estudiante', t?.marginPerParticipant, cur],
    ['Precio final por estudiante', t?.pricePerParticipant, cur],
    ['Precio total del grupo', t?.groupPrice, cur],
    ['Margen del grupo', t?.groupMargin, cur],
    ['Aproximado en pesos por estudiante', t?.pricePerParticipantMxn, 'MXN'],
    ['Margen del grupo en pesos', t?.groupMarginMxn, 'MXN'],
  ];
  for (const [label, value, c] of summary) ws.addRow([label, num(value), c]).getCell(1).font = { bold: true };
  if (!t) ws.addRow(['Sin totales: faltan tipos de cambio', ...q.warnings.map((w) => w.message)]);

  const fx = wb.addWorksheet('Tipos de cambio');
  fx.addRow(['De', 'A', 'Tipo de cambio', 'Fecha', 'Fuente']).font = { bold: true };
  for (const f of q.fxRates) fx.addRow([f.fromCurrency, f.toCurrency, num(f.rate), f.rateDate, f.source]);

  const hist = wb.addWorksheet('Autorización y envío');
  hist.addRow(['Evento', 'Persona', 'Fecha', 'Detalle']).font = { bold: true };
  for (const r of q.reviews)
    hist.addRow([r.decision === 'APPROVED' ? 'Autorizó' : 'Devolvió', r.reviewer, r.at, r.comment ?? '']);
  for (const d of q.deliveries) hist.addRow(['Enviada', d.sentBy, d.sentOn, `${d.channel}: ${d.recipients}`]);

  for (const sheet of [ws, fx, hist]) sheet.columns.forEach((c) => (c.width = 24));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
