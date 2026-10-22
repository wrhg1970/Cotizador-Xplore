import { D, type Dec, QuoteEngineError, safeDivide } from './money.js';

function assertRate(rate: Dec, { maxExclusive }: { maxExclusive?: number } = {}): void {
  const tooHigh = maxExclusive !== undefined && rate.gte(maxExclusive);
  if (rate.isNegative() || tooHigh) {
    throw new QuoteEngineError('RATE_OUT_OF_RANGE', `Tasa fuera de rango: ${rate.toString()}`);
  }
}

/** FORMULAS.md #1 */
export const lineTotal = (quantity: Dec, unitCost: Dec): Dec => quantity.mul(unitCost);

/** FORMULAS.md #8: markup over cost. */
export function priceFromMarkup(cost: Dec, markupRate: Dec): Dec {
  assertRate(markupRate);
  return cost.mul(new D(1).plus(markupRate));
}

/** FORMULAS.md #9: target gross margin over sale price; rate must be < 1. */
export function priceFromTargetMargin(cost: Dec, targetMarginRate: Dec): Dec {
  assertRate(targetMarginRate, { maxExclusive: 1 });
  return safeDivide(cost, new D(1).minus(targetMarginRate));
}

/** Gross margin over sale price, e.g. markup 20% → 16.67%. */
export const grossMarginRate = (cost: Dec, salePrice: Dec): Dec =>
  safeDivide(salePrice.minus(cost), salePrice);

/** FORMULAS.md #10 */
export function applyDiscount(listPrice: Dec, discountRate: Dec): Dec {
  assertRate(discountRate, { maxExclusive: 1 });
  return listPrice.mul(new D(1).minus(discountRate));
}

/** FORMULAS.md #11: amount in `from` currency × rate (units of `to` per 1 `from`). */
export function convert(amount: Dec, rate: { from: string; to: string; value: Dec }): Dec {
  if (rate.value.lte(0)) throw new QuoteEngineError('RATE_OUT_OF_RANGE', 'El tipo de cambio debe ser > 0');
  return amount.mul(rate.value);
}
