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
  lines: { category: Category; quantity: Dec; unitCost: Dec; currency: string }[];
  /** Units of saleCurrency per 1 unit of the key currency. */
  fxRates: Record<string, Dec>;
  /** MXN per 1 saleCurrency, for the approximate peso figures only. */
  mxnRate?: Dec | null;
}

const headcount = (q: QuoteInput, c: Category) =>
  c === 'PER_CHAPERONE' ? q.chaperones : c === 'PER_STAFF' ? q.staff : 1;

/**
 * The same quote at another group size (V2 volume ladder). With "1 lugar liberado por cada N", the group
 * travels with one chaperone per free place earned; the extra ones are school chaperones, never fewer
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
  const lineTotals = q.lines.map((l) => {
    const rate = l.currency === q.saleCurrency ? new D(1) : q.fxRates[l.currency];
    if (!rate)
      throw new QuoteEngineError('MISSING_FX', `Falta tipo de cambio ${l.currency} → ${q.saleCurrency}`);
    // Per-participant lines stay per head; everything else is the line's total for the group.
    return lineTotal(l.quantity, l.unitCost).mul(rate).mul(headcount(q, l.category));
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
