import { D, type Dec, QuoteEngineError, safeDivide } from './money.js';
import { lineTotal, priceFromTargetMargin } from './pricing.js';

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
}

const headcount = (q: QuoteInput, c: Category) =>
  c === 'PER_CHAPERONE' ? q.chaperones : c === 'PER_STAFF' ? q.staff : 1;

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
  const pricePerParticipant = priceFromTargetMargin(costPerParticipant, q.targetMarginRate);
  const marginPerParticipant = pricePerParticipant.minus(costPerParticipant);
  return {
    lineTotals,
    directPerParticipant,
    sharedTotal,
    sharedPerParticipant,
    costPerParticipant,
    marginPerParticipant,
    pricePerParticipant,
    groupPrice: pricePerParticipant.mul(q.participants),
    groupMargin: marginPerParticipant.mul(q.participants),
  };
}
