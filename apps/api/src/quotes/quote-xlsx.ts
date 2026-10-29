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
const FREQUENCY: Record<string, string> = { MONTHLY: 'Mensual', BIWEEKLY: 'Quincenal', WEEKLY: 'Semanal' };
const MONEY = '#,##0.00';
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3E8FA' } };
// Money stays a decimal string in the app; Excel needs numbers to sum, 2–4 decimals fit a double exactly enough.
const num = (s: string | null | undefined) => (s == null ? null : Number(s));

type Row = [label: string, value: string | number | null | undefined, style?: 'total' | 'strong' | 'title'];

/** Writes a two-column block (label, amount) starting at `col`, row `top`, like a block of Finance's sheet. */
function block(ws: ExcelJS.Worksheet, top: number, col: number, rows: Row[]) {
  rows.forEach(([label, value, style], i) => {
    const r = ws.getRow(top + i);
    const l = r.getCell(col);
    const v = r.getCell(col + 1);
    l.value = label;
    v.value = typeof value === 'string' ? num(value) : (value ?? null);
    v.numFmt = MONEY;
    if (style) l.font = v.font = { bold: true };
    if (style === 'total' || style === 'strong') l.fill = v.fill = TOTAL_FILL;
    if (style === 'strong') l.font = v.font = { bold: true, size: 12 };
  });
}

/** Finance's EE sheet: concepts per student on the left, chaperone expenses on the right (same as the app). */
function eeSheet(wb: ExcelJS.Workbook, q: QuoteDto, req: { folio: string; groupName: string }) {
  const ws = wb.addWorksheet('Cotización');
  const cur = q.saleCurrency;
  ws.addRows([
    ['USO INTERNO: contiene costos y comisión'],
    [],
    ['Folio', req.folio, '', 'Estudiantes', q.participants],
    ['Grupo', req.groupName, '', 'Chaperones de la escuela', q.chaperones],
    ['Escenario', `${q.scenarioName} · v${q.number}`, '', 'Chaperones EE', q.staff],
    ['Estado', STATUS[q.status] ?? q.status, '', 'Vigencia', q.validUntil],
    ['Moneda de venta', cur, '', 'Tipo de cambio a MXN', num(q.mxnRate)],
    [],
  ]);
  ws.getCell('A1').font = { bold: true, color: { argb: 'FFB42318' } };
  ws.columns = [{ width: 46 }, { width: 18 }, { width: 4 }, { width: 34 }, { width: 18 }];

  const t = q.totals;
  const s = q.sheet;
  if (!t || !s) {
    ws.addRow(['Sin totales: faltan tipos de cambio']);
    for (const w of q.warnings) ws.addRow([w.message]);
    return;
  }
  // Line totals come from the server already converted and multiplied by headcount.
  const lines = (category: string): Row[] =>
    q.lines
      .map((l, i) => ({ l, total: t.lineTotals[i] }))
      .filter(({ l }) => l.category === category)
      .map(({ l, total }) => [l.internalOnly ? `${l.description} (interno)` : l.description, total]);

  const top = ws.rowCount + 1;
  const left: Row[] = [
    ['Conceptos por estudiante', null, 'title'],
    ...lines('PER_PARTICIPANT'),
    ['SubTotal 1', t.directPerParticipant, 'total'],
    ['Gastos del líder (total chaperones ÷ estudiantes)', s.leaderPerParticipant],
    ...(Number(s.groupFixedTotal) > 0
      ? [['Fijos del grupo ÷ estudiantes', s.groupFixedPerParticipant] as Row]
      : []),
    ['SubTotal 2', t.costPerParticipant, 'total'],
    ['% Comisión (sobre el precio final)', Number(q.targetMarginRate)],
    ['Comisión por estudiante', t.marginPerParticipant],
    ['Comisión del grupo', t.groupMargin],
    [`PRECIO FINAL (${cur})`, t.pricePerParticipant, 'strong'],
    ['Total del grupo', t.groupPrice],
    ...(t.pricePerParticipantMxn
      ? [['Estimado en pesos por estudiante (MXN)', t.pricePerParticipantMxn] as Row]
      : []),
    ...(t.groupMarginMxn ? [['Comisión del grupo en pesos (MXN)', t.groupMarginMxn] as Row] : []),
  ];
  const right: Row[] = [
    ['Gastos de chaperones', null, 'title'],
    ...lines('PER_STAFF'),
    ...lines('PER_CHAPERONE'),
    ['SubTotal chaperones', s.chaperonesTotal, 'total'],
    ['Fondo de emergencia', s.emergencyFund],
    ['Total chaperones', s.totalChaperones, 'strong'],
    ...(Number(s.groupFixedTotal) > 0
      ? ([
          ['Fijos del grupo', null, 'title'],
          ...lines('PER_GROUP'),
          ['Total fijos del grupo', s.groupFixedTotal, 'total'],
        ] as Row[])
      : []),
  ];
  block(ws, top, 1, left);
  block(ws, top, 4, right);
  const pct = ws.getCell(`B${top + left.findIndex(([l]) => l.startsWith('% Comisión'))}`);
  pct.numFmt = '0.00%';
}

/** Internal workbook for Finance: the EE sheet, every input line, payment plan, itinerary and history. */
export async function quoteWorkbook(q: QuoteDto, req: { folio: string; groupName: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  eeSheet(wb, q, req);

  const detail = wb.addWorksheet('Conceptos');
  detail.addRow([
    'Tipo',
    'Concepto',
    'Cantidad',
    'Costo unitario',
    'Moneda',
    `Total en ${q.saleCurrency}`,
    'Solo interno',
    'Fuente del costo',
    'Nota',
  ]).font = { bold: true };
  q.lines.forEach((l, i) =>
    detail.addRow([
      CATEGORY[l.category] ?? l.category,
      l.description,
      num(l.quantity),
      num(l.unitCost),
      l.currency,
      num(q.totals?.lineTotals[i]),
      l.internalOnly ? 'Sí' : 'No',
      l.costSource ?? '',
      l.note ?? '',
    ]),
  );

  const pay = wb.addWorksheet('Plan de pagos');
  if (q.paymentPlan) {
    pay.addRow(['Frecuencia', FREQUENCY[q.paymentPlan.frequency] ?? q.paymentPlan.frequency]);
    pay.addRow([]);
    pay.addRow(['Pago', 'Fecha límite', `Monto por estudiante (${q.saleCurrency})`]).font = { bold: true };
    const schedule = q.paymentSchedule ?? [];
    if (!schedule.length)
      pay.addRow(['El calendario no cuadra o faltan tipos de cambio; revísalo en la app']);
    const count = schedule.filter((p) => p.number > 0).length;
    for (const p of schedule)
      pay.addRow([p.number === 0 ? 'Inscripción' : `Pago ${p.number} de ${count}`, p.dueDate, num(p.amount)]);
    pay.getColumn(3).numFmt = MONEY;
  } else pay.addRow(['Sin plan de pagos']);
  if (q.freePlaces)
    pay.addRow([
      'Lugares liberados',
      q.freePlaces,
      `1 por cada ${q.studentsPerFreePlace} estudiantes, para ${q.freePlaceBenefit === 'STUDENT' ? 'beca de estudiante' : 'chaperón'}`,
    ]);

  const it = wb.addWorksheet('Itinerario');
  it.addRow(['Día', 'Actividad', 'Detalle']).font = { bold: true };
  for (const d of q.itinerary ?? []) it.addRow([d.day, d.title, d.details ?? '']);
  if (q.exclusions.length) {
    it.addRow([]);
    it.addRow(['No incluye']).font = { bold: true };
    for (const e of q.exclusions) it.addRow(['', e]);
  }

  const fx = wb.addWorksheet('Tipos de cambio');
  fx.addRow(['De', 'A', 'Tipo de cambio', 'Fecha', 'Fuente']).font = { bold: true };
  for (const f of q.fxRates) fx.addRow([f.fromCurrency, f.toCurrency, num(f.rate), f.rateDate, f.source]);

  const hist = wb.addWorksheet('Autorización y envío');
  hist.addRow(['Evento', 'Persona', 'Fecha', 'Detalle']).font = { bold: true };
  for (const r of q.reviews)
    hist.addRow([r.decision === 'APPROVED' ? 'Autorizó' : 'Devolvió', r.reviewer, r.at, r.comment ?? '']);
  for (const d of q.deliveries) hist.addRow(['Enviada', d.sentBy, d.sentOn, `${d.channel}: ${d.recipients}`]);

  for (const sheet of [detail, pay, it, fx, hist]) sheet.columns.forEach((c) => (c.width = 24));
  it.getColumn(3).width = 60;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
