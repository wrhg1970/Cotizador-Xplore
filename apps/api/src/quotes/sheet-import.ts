import { GoogleGenAI } from '@google/genai';
import { ItineraryDay, QuoteLineInput, RequestDraft } from '@ee/contracts';
import ExcelJS from 'exceljs';
import { z } from 'zod';

/** Model input cap: a cost sheet is a few hundred cells; anything longer is noise or abuse. */
export const MAX_SHEET_TEXT = 60_000;
export const MAX_SHEET_BYTES = 3 * 1024 * 1024;

export class SheetImportError extends Error {}

/** quote = cost lines for a version; request = the trip data for a new request form. */
export type SheetKind = 'quote' | 'request';

/** Seam for tests; the Vertex implementation sends only the sheet text, never user or request data. */
export interface SheetReader {
  read(sheetText: string, kind?: SheetKind): Promise<unknown>;
}
export const SHEET_READER = Symbol('SHEET_READER');

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue); // formula: keep the computed value
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
  }
  return String(v);
};

/** Every tab as "A1: value" rows, so the model sees layout without formulas or styling. */
export async function sheetToText(file: Buffer, fileName: string): Promise<string> {
  if (/\.csv$/i.test(fileName)) return file.toString('utf8').slice(0, MAX_SHEET_TEXT);
  if (!/\.xlsx$/i.test(fileName)) throw new SheetImportError('Sube un archivo .xlsx o .csv');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw new SheetImportError('El archivo no es un Excel válido');
  }
  const out: string[] = [];
  wb.eachSheet((ws) => {
    out.push(`=== Pestaña "${ws.name}" ===`);
    ws.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell((cell) => {
        const t = cellText(cell.value).trim();
        if (t) cells.push(`${cell.address}: ${t}`);
      });
      if (cells.length) out.push(cells.join(' | '));
    });
  });
  const text = out.join('\n');
  if (!text.trim()) throw new SheetImportError('La hoja está vacía');
  return text.slice(0, MAX_SHEET_TEXT);
}

const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#]|$)/;

export const googleSheetId = (url: string): string | null => SHEET_URL.exec(url.trim())?.[1] ?? null;

/** Public ("anyone with the link") sheets only; the URL is rebuilt from the id so no other host is reachable. */
export async function fetchGoogleSheet(url: string): Promise<Buffer> {
  const id = googleSheetId(url);
  if (!id) throw new SheetImportError('La liga debe ser de Google Sheets: docs.google.com/spreadsheets/d/…');
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, {
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const type = res?.headers.get('content-type') ?? '';
  if (!res?.ok || type.includes('text/html'))
    throw new SheetImportError(
      'No se pudo leer la hoja. Compártela como "Cualquier persona con el enlace: Lector" o descárgala como .xlsx y súbela.',
    );
  const size = Number(res.headers.get('content-length') ?? 0);
  if (size > MAX_SHEET_BYTES) throw new SheetImportError('La hoja pesa más de 3 MB');
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_SHEET_BYTES) throw new SheetImportError('La hoja pesa más de 3 MB');
  return body;
}

const decimal = {
  type: 'string',
  description: 'Número con punto decimal, sin separadores de miles ni símbolo',
};

/** JSON schema the model must answer with; the server still validates every field afterwards. */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Resumen en español: qué se detectó y qué supuestos se aplicaron',
    },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: QuoteLineInput.shape.category.options },
          description: { type: 'string' },
          quantity: decimal,
          unitCost: decimal,
          currency: { type: 'string', enum: QuoteLineInput.shape.currency.options },
          internalOnly: { type: 'boolean' },
        },
        required: ['category', 'description', 'quantity', 'unitCost', 'currency', 'internalOnly'],
      },
    },
    targetMarginRate: { type: ['string', 'null'], description: '% de comisión como fracción (0.18 = 18%)' },
    itinerary: {
      type: 'array',
      items: {
        type: 'object',
        properties: { day: { type: 'integer' }, title: { type: 'string' }, details: { type: 'string' } },
        required: ['day', 'title'],
      },
    },
    exclusions: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'lines', 'warnings'],
};

const SYSTEM_INSTRUCTION = `Eres cotizador de Estudiantes Embajadores (viajes educativos grupales).
Recibes el contenido de una hoja de cálculo de costos como celdas "A1: valor" y lo conviertes en conceptos de cotización.

Categorías:
- PER_PARTICIPANT: costo por estudiante (precio neto del programa, hospedaje, transporte, comidas, kit, seguro, promociones, envío de kits, operación, vuelos, visas).
- PER_STAFF: costo por cada chaperón de EE (gastos de viaje, seguro, transfer, kit, viáticos).
- PER_CHAPERONE: costo por cada chaperón de la escuela.
- PER_GROUP: costo fijo total del grupo, que se reparte entre los estudiantes.
- CONTINGENCY: fondo de emergencia.

Reglas:
- Copia los importes tal como están en la hoja, en su moneda. Nunca conviertas monedas ni inventes tipos de cambio.
- quantity es cuántas veces aplica el costo unitario a una persona (por ejemplo, días de viáticos); usa "1" si no se indica.
- Si un importe es un total del grupo y no por persona, usa PER_GROUP.
- Marca internalOnly=true en comisiones (escuela, coordinadora) y costos que el cliente no debe ver listados.
- No inventes conceptos ni importes. Si algo es ambiguo, omítelo y explícalo en warnings.
- Si hay varias opciones o columnas comparativas, usa solo la primera y avisa en warnings.
- targetMarginRate solo si la hoja indica el % de comisión o margen; si no, null.
- Ignora nombres de personas, correos y teléfonos.`;

const REQUEST_SCHEMA = {
  type: 'object',
  properties: {
    groupName: { type: ['string', 'null'], description: 'Nombre del grupo o del viaje' },
    clientName: { type: ['string', 'null'], description: 'Escuela o cliente' },
    program: { type: ['string', 'null'], description: 'Programa (campamento, inmersión, etc.)' },
    city: { type: ['string', 'null'], description: 'Ciudad o ciudades de destino' },
    countryCode: { type: ['string', 'null'], description: 'País de destino, código ISO de 2 letras' },
    departureDate: { type: ['string', 'null'], description: 'Fecha de salida AAAA-MM-DD' },
    returnDate: { type: ['string', 'null'], description: 'Fecha de regreso AAAA-MM-DD' },
    participants: { type: ['integer', 'null'], description: 'Número de estudiantes' },
    chaperones: { type: ['integer', 'null'], description: 'Chaperones de la escuela' },
    staff: { type: ['integer', 'null'], description: 'Chaperones o staff de EE' },
    requirements: { type: ['string', 'null'], description: 'Requerimientos y notas del viaje' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['warnings'],
};

const REQUEST_INSTRUCTION = `Eres asistente de Estudiantes Embajadores (viajes educativos grupales).
Recibes una hoja de cálculo como celdas "A1: valor" (ficha de viaje, cotización o lista del colegio) y extraes los datos para dar de alta una solicitud de viaje.

Reglas:
- Solo datos que aparezcan en la hoja; si un dato no está o es ambiguo, déjalo en null y explícalo en warnings.
- Fechas en formato AAAA-MM-DD. País como código ISO de 2 letras (Canadá = CA, Estados Unidos = US, Reino Unido = GB).
- participants son estudiantes; no sumes adultos. chaperones son adultos de la escuela; staff son acompañantes de EE.
- No incluyas costos, precios, nombres de personas, correos ni teléfonos en ningún campo.
- requirements: resumen breve de requerimientos del viaje (hospedaje, actividades, comidas), sin datos personales.`;

export class VertexSheetReader implements SheetReader {
  private readonly ai: GoogleGenAI;

  constructor(
    project: string,
    location: string,
    private readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ vertexai: true, project, location });
  }

  async read(sheetText: string, kind: SheetKind = 'quote'): Promise<unknown> {
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: `Contenido de la hoja:\n----\n${sheetText}\n----`,
      config: {
        systemInstruction: kind === 'request' ? REQUEST_INSTRUCTION : SYSTEM_INSTRUCTION,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema: kind === 'request' ? REQUEST_SCHEMA : RESPONSE_SCHEMA,
        abortSignal: AbortSignal.timeout(60_000),
      },
    });
    try {
      return JSON.parse(res.text ?? '');
    } catch {
      throw new SheetImportError('La IA no devolvió una respuesta válida; intenta de nuevo');
    }
  }
}

const Raw = z.object({
  summary: z.string().catch(''),
  lines: z.array(z.unknown()).catch([]),
  targetMarginRate: z.unknown().optional(),
  itinerary: z.array(z.unknown()).catch([]).optional(),
  exclusions: z.array(z.unknown()).catch([]).optional(),
  warnings: z.array(z.unknown()).catch([]).optional(),
});

const asDecimal = (v: unknown) =>
  typeof v === 'number' ? String(v) : typeof v === 'string' ? v.replace(/[,\s$]/g, '') : v;

/** Keeps only what passes the same validation as a manual edit; everything dropped becomes a warning. */
export function normalizeProposal(raw: unknown) {
  const r = Raw.parse(raw ?? {});
  const warnings = (r.warnings ?? [])
    .filter((w): w is string => typeof w === 'string')
    .map((w) => w.slice(0, 500));
  const lines = r.lines.flatMap((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    const parsed = QuoteLineInput.safeParse({
      category: o.category,
      description: typeof o.description === 'string' ? o.description.trim().slice(0, 300) : o.description,
      quantity: asDecimal(o.quantity),
      unitCost: asDecimal(o.unitCost),
      currency: o.currency,
      internalOnly: o.internalOnly === true,
    });
    return parsed.success ? [parsed.data] : [];
  });
  if (lines.length < r.lines.length)
    warnings.push(
      `Se descartaron ${r.lines.length - lines.length} conceptos con datos incompletos o inválidos`,
    );
  const rate = asDecimal(r.targetMarginRate);
  const targetMarginRate =
    typeof rate === 'string' && /^0(\.\d{1,6})?$/.test(rate) && Number(rate) < 0.95 ? rate : null;
  const itinerary = (r.itinerary ?? []).flatMap((d) => {
    const parsed = ItineraryDay.safeParse(d);
    return parsed.success ? [parsed.data] : [];
  });
  const exclusions = (r.exclusions ?? [])
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    .map((e) => e.trim().slice(0, 300));
  return {
    summary: r.summary.slice(0, 2000),
    lines: lines.slice(0, 200),
    targetMarginRate,
    itinerary: itinerary.slice(0, 120),
    exclusions: exclusions.slice(0, 50),
    warnings: warnings.slice(0, 30),
  };
}
export type ImportProposal = ReturnType<typeof normalizeProposal>;

/** Keeps only fields that pass the request form's own validation; the rest become warnings. */
export function normalizeRequestDraft(raw: unknown) {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const warnings = (Array.isArray(o.warnings) ? o.warnings : [])
    .filter((w): w is string => typeof w === 'string')
    .map((w) => w.slice(0, 500));
  const draft: Record<string, unknown> = {};
  const shape = RequestDraft.shape;
  for (const key of [
    'groupName',
    'clientName',
    'program',
    'city',
    'countryCode',
    'departureDate',
    'returnDate',
    'participants',
    'chaperones',
    'staff',
    'requirements',
  ] as const) {
    const value = typeof o[key] === 'string' ? (o[key] as string).trim() : o[key];
    if (value === null || value === undefined || value === '') continue;
    const parsed = shape[key].safeParse(key === 'countryCode' ? String(value).toUpperCase() : value);
    if (parsed.success) draft[key] = parsed.data;
    else warnings.push(`No se usó el campo ${key}: el valor de la hoja no es válido`);
  }
  if (
    draft.departureDate &&
    draft.returnDate &&
    (draft.returnDate as string) < (draft.departureDate as string)
  ) {
    delete draft.returnDate;
    warnings.push('La fecha de regreso era anterior a la salida; revísala');
  }
  return { draft: draft as RequestDraft, warnings: warnings.slice(0, 30) };
}
