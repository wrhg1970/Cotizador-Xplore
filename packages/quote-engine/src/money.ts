import { Decimal } from 'decimal.js';

// Independent instance so global Decimal config elsewhere can't change results.
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export class QuoteEngineError extends Error {
  constructor(
    readonly code: 'DIVISION_BY_ZERO' | 'RATE_OUT_OF_RANGE' | 'INVALID_AMOUNT',
    message: string,
  ) {
    super(message);
    this.name = 'QuoteEngineError';
  }
}

/** Parses a decimal string; rejects floats-as-numbers to keep money exact. */
export function dec(value: string): Dec {
  if (!/^-?\d+(\.\d+)?$/.test(value))
    throw new QuoteEngineError('INVALID_AMOUNT', `Importe inválido: ${value}`);
  return new D(value);
}

export function safeDivide(numerator: Dec, denominator: Dec): Dec {
  if (denominator.isZero())
    throw new QuoteEngineError('DIVISION_BY_ZERO', 'El denominador no puede ser cero');
  return numerator.div(denominator);
}

/** Rounds only at explicit points; mode follows the configured policy. */
export function roundMoney(
  value: Dec,
  decimalPlaces: number,
  mode: 'HALF_UP' | 'HALF_EVEN' = 'HALF_UP',
): Dec {
  return value.toDecimalPlaces(decimalPlaces, mode === 'HALF_UP' ? D.ROUND_HALF_UP : D.ROUND_HALF_EVEN);
}
