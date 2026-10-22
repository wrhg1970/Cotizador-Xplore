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

describe('user admin contracts', () => {
  it('rejects unknown fields so clients cannot smuggle role/office data', async () => {
    const { InviteUser } = await import('./index.js');
    const base = {
      email: 'Ana@Example.com',
      name: 'Ana',
      officeId: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
      role: 'QUOTER',
    };
    expect(InviteUser.parse(base).email).toBe('ana@example.com');
    expect(InviteUser.safeParse({ ...base, status: 'ACTIVE' }).success).toBe(false);
    expect(InviteUser.safeParse({ ...base, role: 'ROOT' }).success).toBe(false);
  });
});
