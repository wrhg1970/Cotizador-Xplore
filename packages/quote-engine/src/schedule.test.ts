import { describe, expect, it } from 'vitest';
import { dec } from './money.js';
import { freePlaces, type Payment, paymentSchedule } from './schedule.js';

const sum = (ps: Payment[]) => ps.reduce((a, p) => a.plus(p.amount), dec('0'));

describe('paymentSchedule', () => {
  it('15% registration plus 6 monthly payments that add up to the price', () => {
    const ps = paymentSchedule(dec('5129'), {
      depositRate: dec('0.15'),
      depositDueDate: '2026-11-15',
      installments: 6,
      frequency: 'MONTHLY',
      firstDueDate: '2027-01-31',
    });
    expect(ps.map((p) => [p.number, p.dueDate, p.amount.toString()])).toEqual([
      [0, '2026-11-15', '769.35'],
      [1, '2027-01-31', '726.6'],
      [2, '2027-02-28', '726.6'],
      [3, '2027-03-31', '726.6'],
      [4, '2027-04-30', '726.6'],
      [5, '2027-05-31', '726.6'],
      [6, '2027-06-30', '726.65'],
    ]);
    expect(sum(ps).toString()).toBe('5129');
  });

  it('fixed registration, weekly and biweekly cadence, no registration at all', () => {
    const fixed = paymentSchedule(dec('1000'), {
      depositAmount: dec('100'),
      depositDueDate: '2026-11-01',
      installments: 3,
      frequency: 'BIWEEKLY',
      firstDueDate: '2026-12-01',
    });
    expect(fixed.map((p) => p.dueDate)).toEqual(['2026-11-01', '2026-12-01', '2026-12-15', '2026-12-29']);
    expect(fixed.map((p) => p.amount.toString())).toEqual(['100', '300', '300', '300']);
    const weekly = paymentSchedule(dec('100'), {
      installments: 3,
      frequency: 'WEEKLY',
      firstDueDate: '2026-12-01',
    });
    expect(weekly.map((p) => [p.number, p.amount.toString()])).toEqual([
      [1, '33.33'],
      [2, '33.33'],
      [3, '33.34'],
    ]);
    expect(weekly[2]!.dueDate).toBe('2026-12-15');
  });

  it('rejects impossible plans', () => {
    const base = { installments: 2, frequency: 'MONTHLY' as const, firstDueDate: '2027-01-01' };
    expect(() => paymentSchedule(dec('100'), { ...base, installments: 16 })).toThrow(/15/);
    expect(() => paymentSchedule(dec('100'), { ...base, installments: 0 })).toThrow(/15/);
    expect(() =>
      paymentSchedule(dec('100'), { ...base, depositAmount: dec('100'), depositDueDate: '2026-12-01' }),
    ).toThrow(/menor/);
    expect(() => paymentSchedule(dec('100'), { ...base, depositAmount: dec('10') })).toThrow(/fecha/);
  });
});

describe('freePlaces', () => {
  it('one per N students, rounded down', () => {
    expect(freePlaces(25, 10)).toBe(2);
    expect(freePlaces(9, 10)).toBe(0);
    expect(freePlaces(30, 15)).toBe(2);
  });
});
