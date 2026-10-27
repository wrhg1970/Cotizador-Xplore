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

describe('request contracts', () => {
  const valid = {
    officeId: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
    groupName: 'Verano Grupal UK 2027',
    city: 'Londres y Oxford',
    countryCode: 'GB',
    departureDate: '2027-07-01',
    returnDate: '2027-07-21',
    participants: 20,
    chaperones: 2,
    budget: { amount: '5150.00', currency: 'GBP', basis: 'PER_PARTICIPANT' },
  };

  it('accepts the API_SPEC example and applies defaults', async () => {
    const { CreateRequest } = await import('./index.js');
    const parsed = CreateRequest.parse(valid);
    expect(parsed.staff).toBe(0);
    expect(parsed.priority).toBe('NORMAL');
  });

  it('rejects invalid business data', async () => {
    const { CreateRequest } = await import('./index.js');
    const bad = (patch: object) => CreateRequest.safeParse({ ...valid, ...patch }).success;
    expect(bad({ returnDate: '2027-06-30' })).toBe(false);
    expect(bad({ participants: 0 })).toBe(false);
    expect(bad({ chaperones: -1 })).toBe(false);
    expect(bad({ countryCode: 'XX' })).toBe(false);
    expect(bad({ countryCode: 'gb' })).toBe(false);
    expect(bad({ countryCode: 'UK' })).toBe(false);
    expect(bad({ countryCode: 'EU' })).toBe(false);
    expect(bad({ budget: { amount: '-1', currency: 'GBP', basis: 'TOTAL' } })).toBe(false);
    expect(bad({ budget: { amount: '100', currency: 'GBP' } })).toBe(false);
    expect(bad({ requesterId: valid.officeId })).toBe(false);
    expect(bad({ departureDate: '2027-02-30' })).toBe(false);
  });

  it('update checks dates only when both are sent', async () => {
    const { UpdateRequest } = await import('./index.js');
    expect(UpdateRequest.safeParse({ version: 1, returnDate: '2027-01-01' }).success).toBe(true);
    expect(
      UpdateRequest.safeParse({ version: 1, departureDate: '2027-02-01', returnDate: '2027-01-01' }).success,
    ).toBe(false);
    expect(UpdateRequest.safeParse({ city: 'X' }).success).toBe(false);
    // A partial edit must not inject create-time defaults.
    expect(UpdateRequest.parse({ version: 1, city: 'X' })).toEqual({ version: 1, city: 'X' });
  });
});

describe('quote contracts', () => {
  it('takes a whole final price or a margin, never both', async () => {
    const { UpdateQuote } = await import('./index.js');
    expect(UpdateQuote.safeParse({ targetPricePerParticipant: '5150', rowVersion: 1 }).success).toBe(true);
    for (const p of ['5150.5', '0', '-1', '1e3'])
      expect(UpdateQuote.safeParse({ targetPricePerParticipant: p, rowVersion: 1 }).success).toBe(false);
    expect(
      UpdateQuote.safeParse({ targetPricePerParticipant: '5150', targetMarginRate: '0.1', rowVersion: 1 })
        .success,
    ).toBe(false);
  });
});

describe('payment plan', () => {
  it('needs a date for any registration and puts it before the first payment', async () => {
    const { PaymentPlanInput } = await import('./index.js');
    const base = { installments: 6, frequency: 'MONTHLY', firstDueDate: '2027-01-15' };
    expect(PaymentPlanInput.safeParse(base).success).toBe(true);
    expect(
      PaymentPlanInput.safeParse({ ...base, depositRate: '0.15', depositDueDate: '2026-11-15' }).success,
    ).toBe(true);
    expect(PaymentPlanInput.safeParse({ ...base, depositRate: '0.15' }).success).toBe(false);
    expect(
      PaymentPlanInput.safeParse({
        ...base,
        depositRate: '0.1',
        depositAmount: '100',
        depositDueDate: '2026-11-15',
      }).success,
    ).toBe(false);
    expect(
      PaymentPlanInput.safeParse({ ...base, depositAmount: '100', depositDueDate: '2027-02-01' }).success,
    ).toBe(false);
    expect(PaymentPlanInput.safeParse({ ...base, installments: 16 }).success).toBe(false);
  });
});
