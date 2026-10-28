import type { QuoteDto } from './quotes.controller.js';

export interface FieldChange {
  field: string;
  label: string;
  from: string | number | null;
  to: string | number | null;
}
export interface LineChange {
  change: 'ADDED' | 'REMOVED' | 'CHANGED';
  description: string;
  category: string;
  from: string | null;
  to: string | null;
}

const FIELDS: [keyof QuoteDto, string][] = [
  ['saleCurrency', 'Moneda de venta'],
  ['targetMarginRate', '% comisión'],
  ['participants', 'Estudiantes'],
  ['chaperones', 'Chaperones'],
  ['staff', 'Staff EE'],
  ['validUntil', 'Vigencia'],
  ['mxnRate', 'Tipo de cambio a MXN'],
];

const lineText = (l: QuoteDto['lines'][number]) => `${l.quantity} × ${l.unitCost} ${l.currency}`;
const key = (l: QuoteDto['lines'][number]) => `${l.category}|${l.description.trim().toLowerCase()}`;

/** What changed from one version to the next: headline fields, totals and lines (matched by concept). */
export function compareVersions(prev: QuoteDto, cur: QuoteDto) {
  const fields: FieldChange[] = [];
  for (const [field, label] of FIELDS) {
    const from = prev[field] as string | number | null;
    const to = cur[field] as string | number | null;
    if (from !== to) fields.push({ field, label, from, to });
  }
  for (const [field, label] of [
    ['pricePerParticipant', 'Precio por estudiante'],
    ['groupPrice', 'Precio del grupo'],
    ['costPerParticipant', 'Costo por estudiante'],
  ] as const) {
    const from = prev.totals?.[field] ?? null;
    const to = cur.totals?.[field] ?? null;
    if (from !== to) fields.push({ field, label, from, to });
  }
  const before = new Map(prev.lines.map((l) => [key(l), l]));
  const after = new Map(cur.lines.map((l) => [key(l), l]));
  const lines: LineChange[] = [];
  for (const [k, l] of after) {
    const old = before.get(k);
    if (!old)
      lines.push({
        change: 'ADDED',
        description: l.description,
        category: l.category,
        from: null,
        to: lineText(l),
      });
    else if (lineText(old) !== lineText(l))
      lines.push({
        change: 'CHANGED',
        description: l.description,
        category: l.category,
        from: lineText(old),
        to: lineText(l),
      });
  }
  for (const [k, l] of before)
    if (!after.has(k))
      lines.push({
        change: 'REMOVED',
        description: l.description,
        category: l.category,
        from: lineText(l),
        to: null,
      });
  return { fields, lines };
}
