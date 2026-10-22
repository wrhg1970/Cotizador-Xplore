import { describe, expect, it } from 'vitest';
import { DecimalString, Money } from './index.js';

describe('contracts', () => {
  it('accepts decimal strings and rejects numbers/exponents', () => {
    expect(DecimalString.safeParse('5150.00').success).toBe(true);
    expect(DecimalString.safeParse('1e3').success).toBe(false);
    expect(Money.safeParse({ amount: 5150, currency: 'GBP' }).success).toBe(false);
  });

  it('rejects currencies outside the catalog', () => {
    expect(Money.safeParse({ amount: '1.00', currency: 'BTC' }).success).toBe(false);
  });
});
