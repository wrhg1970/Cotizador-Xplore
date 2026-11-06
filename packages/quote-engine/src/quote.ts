import { D, type Dec, QuoteEngineError, safeDivide } from './money.js';
import { lineTotal, priceFromTargetMargin } from './pricing.js';
import { freePlaces } from './schedule.js';

/**
 * Pilot pricing model, taken from Finance's sheet (ITALIA SPRING BREAK 2027, one tab per option):
 * students pay their own concepts plus an equal share of what chaperones, EE staff and the
 * group as a whole cost; the price is that cost grossed up by a margin over sale price.
 */
export type Category = 'PER_PARTICIPANT' | 'PER_CHAPERONE' | 'PER_STAFF' | 'PER_GROUP' | 'CONTINGENCY';

export interface QuoteInput {
  saleCurrency: string;
  participants: number;
  chaperones: number;
  staff: number;
  /** Margin over sale price; the sheet labels it "% Comisión". */
  targetMarginRate: Dec;
  /** `description` finds the chaperone's course line, the only one gratuities discount. */
  lines: { category: Category; description?: string; quantity: Dec; unitCost: Dec; currency: string }[];
  /** Units of saleCurrency per 1 unit of the key currency. */
  fxRates: Record<string, Dec>;
  /** MXN per 1 saleCurrency, for the approximate peso figures only. */
  mxnRate?: Dec | null;
  /** "1 gratuidad por cada N estudiantes" (Gratuidades por ratio). */
  studentsPerFreePlace?: number | null;
  /** STUDENT = a scholarship, informative only; anything else frees chaperones' course. */
  freePlaceBenefit?: 'CHAPERONE' | 'STUDENT' | null;
}

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * The chaperone's own course/program cost, the only concept a gratuity makes free (Will, 2026-11-06).
 * shortcut: matched by name (catalog "Costo chaperón"); add a per-line flag if offices rename it.
 */
export const isChaperoneCourse = (description = '') =>
  /^costo chaperon|\bcurso\b|\bprograma\b/.test(plain(description));

/**
 * Gratuities earned by ratio, given first to EE staff and then to school chaperones (the same order
 * atGroupSize counts them in); never more than the chaperones travelling.
 */
export function gratuities(
  q: Pick<QuoteInput, 'participants' | 'chaperones' | 'staff' | 'studentsPerFreePlace' | 'freePlaceBenefit'>,
) {
  const total =
    q.studentsPerFreePlace && q.freePlaceBenefit !== 'STUDENT'
      ? freePlaces(q.participants, q.studentsPerFreePlace)
      : 0;
  const staff = Math.min(total, q.staff);
  return { total, staff, chaperones: Math.min(total - staff, q.chaperones) };
}

function headcount(q: QuoteInput, free: ReturnType<typeof gratuities>, l: QuoteInput['lines'][number]) {
  if (l.category !== 'PER_CHAPERONE' && l.category !== 'PER_STAFF') return 1;
  const staff = l.category === 'PER_STAFF';
  const all = staff ? q.staff : q.chaperones;
  return isChaperoneCourse(l.description) ? all - (staff ? free.staff : free.chaperones) : all;
}

/** Chaperones' insurance, kit and transfer cost exactly what a student's do (Will, 2026-11-06). */
const MIRRORED = new Set(['seguro', 'kit', 'transfer']);
const firstWord = (s: string) => plain(s).split(/\s+/)[0] ?? '';

/** Chaperone line index → the student line it copies (first student line with the same first word). */
export function chaperoneMirrors(lines: { category: string; description: string }[]) {
  const source = new Map<string, number>();
  lines.forEach((l, i) => {
    const w = firstWord(l.description);
    if (l.category === 'PER_PARTICIPANT' && MIRRORED.has(w) && !source.has(w)) source.set(w, i);
  });
  const mirrors = new Map<number, number>();
  lines.forEach((l, i) => {
    const s = source.get(firstWord(l.description));
    if ((l.category === 'PER_CHAPERONE' || l.category === 'PER_STAFF') && s !== undefined) mirrors.set(i, s);
  });
  return mirrors;
}

/** Copies quantity, unit cost and currency of the student's Seguro/Kit/Transfer into chaperone lines. */
export function syncChaperoneLines<
  T extends { category: string; description: string; quantity: string; unitCost: string; currency: string },
>(lines: T[]): T[] {
  const mirrors = chaperoneMirrors(lines);
  if (!mirrors.size) return lines;
  return lines.map((l, i) => {
    const s = mirrors.has(i) ? lines[mirrors.get(i)!]! : null;
    return s ? { ...l, quantity: s.quantity, unitCost: s.unitCost, currency: s.currency } : l;
  });
}

/**
 * The same quote at another group size (V2 volume ladder). With "1 gratuidad por cada N", the group
 * travels with one chaperone per gratuity earned; the extra ones are school chaperones, never fewer
 * than the quote already has.
 */
export function atGroupSize<T extends Pick<QuoteInput, 'participants' | 'chaperones' | 'staff'>>(
  q: T,
  participants: number,
  studentsPerFreePlace?: number | null,
): T {
  const earned = studentsPerFreePlace ? freePlaces(participants, studentsPerFreePlace) : 0;
  return { ...q, participants, chaperones: Math.max(q.chaperones, earned - q.staff) };
}

export function calculateQuote(q: QuoteInput) {
  const free = gratuities(q);
  const lineTotals = q.lines.map((l) => {
    const rate = l.currency === q.saleCurrency ? new D(1) : q.fxRates[l.currency];
    if (!rate)
      throw new QuoteEngineError('MISSING_FX', `Falta tipo de cambio ${l.currency} → ${q.saleCurrency}`);
    // Per-participant lines stay per head; everything else is the line's total for the group.
    return lineTotal(l.quantity, l.unitCost)
      .mul(rate)
      .mul(headcount(q, free, l));
  });
  const sum = (pick: (c: Category) => boolean) =>
    lineTotals.reduce((acc, t, i) => (pick(q.lines[i]!.category) ? acc.plus(t) : acc), new D(0));

  const directPerParticipant = sum((c) => c === 'PER_PARTICIPANT');
  const sharedTotal = sum((c) => c !== 'PER_PARTICIPANT');
  const sharedPerParticipant = safeDivide(sharedTotal, new D(q.participants));
  const costPerParticipant = directPerParticipant.plus(sharedPerParticipant);
  // Finance rounds the price up to the next whole unit; the margin absorbs the difference.
  const pricePerParticipant = priceFromTargetMargin(costPerParticipant, q.targetMarginRate).ceil();
  const marginPerParticipant = pricePerParticipant.minus(costPerParticipant);
  const groupMargin = marginPerParticipant.mul(q.participants);
  const categories: Category[] = [
    'PER_PARTICIPANT',
    'PER_CHAPERONE',
    'PER_STAFF',
    'PER_GROUP',
    'CONTINGENCY',
  ];
  return {
    lineTotals,
    /** Chaperones whose course is free this time (EE staff first, then the school's). */
    gratuities: free,
    /** Sale-currency total per category, headcount applied; per-participant stays per head. */
    byCategory: Object.fromEntries(categories.map((c) => [c, sum((x) => x === c)])) as Record<Category, Dec>,
    directPerParticipant,
    sharedTotal,
    sharedPerParticipant,
    costPerParticipant,
    marginPerParticipant,
    pricePerParticipant,
    groupPrice: pricePerParticipant.mul(q.participants),
    groupMargin,
    pricePerParticipantMxn: q.mxnRate ? pricePerParticipant.mul(q.mxnRate).ceil() : null,
    groupMarginMxn: q.mxnRate ? groupMargin.mul(q.mxnRate) : null,
  };
}
