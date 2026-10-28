import { COUNTRIES, type CurrencyCode } from '@ee/contracts';
import ExcelJS from 'exceljs';
import { cellText, SheetImportError } from '../quotes/sheet-import.js';

/** One "Opción N" tab of an EE cost workbook, at price level (the line detail is not migrated). */
export interface HistoryOption {
  name: string;
  saleCurrency: CurrencyCode;
  mxnRate: string | null;
  participants: number;
  targetMarginRate: string;
  pricePerParticipant: string;
}

export interface HistoryPreview {
  groupName: string | null;
  clientName: string | null;
  program: string | null;
  officeName: string | null;
  city: string | null;
  countryCode: string | null;
  departureDate: string | null;
  returnDate: string | null;
  staff: number;
  options: HistoryOption[];
  warnings: string[];
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

const CURRENCY: Record<string, CurrencyCode> = {
  EURO: 'EUR',
  EUROS: 'EUR',
  EUR: 'EUR',
  DOLAR: 'USD',
  DOLARES: 'USD',
  USD: 'USD',
  PESO: 'MXN',
  PESOS: 'MXN',
  MXN: 'MXN',
  LIBRA: 'GBP',
  LIBRAS: 'GBP',
  GBP: 'GBP',
  CAD: 'CAD',
  AUD: 'AUD',
};

const COUNTRY_BY_NAME = new Map(COUNTRIES.map((c) => [norm(c.name), c.code]));

type Cell = { row: number; col: number; value: ExcelJS.CellValue };

function cells(ws: ExcelJS.Worksheet): Cell[] {
  const out: Cell[] = [];
  ws.eachRow((row, r) => row.eachCell((c, col) => out.push({ row: r, col, value: c.value })));
  return out;
}

/** Values to the right of the first cell labelled `label` (the EE sheets repeat labels in B and C). */
function rightOf(all: Cell[], label: string, which: 'first' | 'last' = 'first'): ExcelJS.CellValue[] {
  const hits = all.filter((c) => norm(cellText(c.value)) === label);
  const hit = which === 'first' ? hits[0] : hits.at(-1);
  if (!hit) return [];
  return all
    .filter((c) => c.row === hit.row && c.col > hit.col && cellText(c.value).trim() !== '')
    .filter((c) => norm(cellText(c.value)) !== label)
    .sort((a, b) => a.col - b.col)
    .map((c) => c.value);
}

const text = (v: ExcelJS.CellValue | undefined) => (v === undefined ? null : cellText(v).trim() || null);

function num(v: ExcelJS.CellValue | undefined): number | null {
  const t = text(v);
  const n = t === null ? NaN : Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function date(v: ExcelJS.CellValue | undefined): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = text(v);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); // dd/mm/yyyy, as typed in Mexico
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}

function option(ws: ExcelJS.Worksheet, warnings: string[]): HistoryOption | null {
  const all = cells(ws);
  const [currencyName, rate] = rightOf(all, 'DIVISA');
  const currency = CURRENCY[norm(text(currencyName) ?? '')];
  const participants = num(rightOf(all, 'PARTICIPANTES')[0]);
  const price = num(rightOf(all, 'PRECIO FINAL')[0]);
  const margin = num(rightOf(all, '% COMISION')[0]) ?? 0;
  if (!currency || !participants || !price) {
    warnings.push(`"${ws.name}": falta divisa, participantes o precio final; se omitió`);
    return null;
  }
  if (margin < 0 || margin >= 1) {
    warnings.push(`"${ws.name}": % de comisión fuera de rango; se omitió`);
    return null;
  }
  const mxn = currency === 'MXN' ? null : num(rate);
  return {
    name: ws.name.trim(),
    saleCurrency: currency,
    mxnRate: mxn && mxn > 0 ? mxn.toFixed(6) : null,
    participants: Math.round(participants),
    targetMarginRate: margin.toFixed(6),
    pricePerParticipant: price.toFixed(2),
  };
}

/** Reads an EE cost workbook ("Consolidado" + "Opción N" tabs) by its labels; nothing is guessed. */
export async function readHistorySheet(file: Buffer): Promise<HistoryPreview> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw new SheetImportError('El archivo no es un Excel válido');
  }
  const summary = wb.worksheets.find((ws) => norm(ws.name) === 'CONSOLIDADO') ?? wb.worksheets[0];
  if (!summary) throw new SheetImportError('El Excel no tiene pestañas');
  const all = cells(summary);
  const warnings: string[] = [];
  const first = (label: string) => text(rightOf(all, label)[0]);

  const country = first('PAIS DESTINO');
  const countryCode = country ? (COUNTRY_BY_NAME.get(norm(country)) ?? null) : null;
  if (country && !countryCode) warnings.push(`País "${country}" no reconocido`);
  const city = first('CIUDAD DESTINO');
  // "VARIAS" (several cities) is not a city; the country name stands in.
  const cityName = city && norm(city) !== 'VARIAS' ? city : country;

  const chaperonesRow = all.find((c) => norm(cellText(c.value)) === 'CHAPERONES');
  const staffCell = chaperonesRow
    ? all.find((c) => c.row === chaperonesRow.row + 1 && c.col === chaperonesRow.col + 1)
    : undefined;

  const options = wb.worksheets
    .filter((ws) => /^OPCION\s*\d+$/.test(norm(ws.name)))
    .map((ws) => option(ws, warnings))
    .filter((o): o is HistoryOption => o !== null);
  if (!options.length) warnings.push('No se encontró ninguna pestaña "Opción N" con precio final');

  return {
    groupName: first('NOMBRE GRUPO'),
    clientName: first('CLIENTE'),
    program: first('ORGANIZACION'),
    officeName: first('OFICINA'),
    city: cityName,
    countryCode,
    departureDate: date(rightOf(all, 'FECHA SALIDA')[0]),
    returnDate: date(rightOf(all, 'FECHA REGRESO')[0]),
    staff: Math.max(0, Math.round(num(staffCell?.value) ?? 0)),
    options,
    warnings,
  };
}
