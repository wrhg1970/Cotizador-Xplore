import { describe, expect, it } from 'vitest';
import {
  applyDiscount,
  calculationHash,
  convert,
  dec,
  grossMarginRate,
  lineTotal,
  priceFromMarkup,
  priceFromTargetMargin,
  QuoteEngineError,
  roundMoney,
  safeDivide,
} from './index.js';

describe('quote-engine', () => {
  it('is exact where floats are not (0.1 + 0.2)', () => {
    expect(dec('0.1').plus(dec('0.2')).toString()).toBe('0.3');
  });

  it('markup 20% yields 16.67% gross margin (FORMULAS.md)', () => {
    const cost = dec('1000');
    const price = priceFromMarkup(cost, dec('0.20'));
    expect(price.toString()).toBe('1200');
    expect(roundMoney(grossMarginRate(cost, price).mul(100), 2).toString()).toBe('16.67');
  });

  it('target margin 20% is not the same as markup 20%', () => {
    expect(priceFromTargetMargin(dec('1000'), dec('0.20')).toString()).toBe('1250');
  });

  it('rejects target margin >= 1 and negative rates', () => {
    expect(() => priceFromTargetMargin(dec('1000'), dec('1'))).toThrow(QuoteEngineError);
    expect(() => priceFromMarkup(dec('1000'), dec('-0.1'))).toThrow(QuoteEngineError);
  });

  it('blocks division by zero', () => {
    expect(() => safeDivide(dec('10'), dec('0'))).toThrow(/cero/);
  });

  it('computes line totals, discounts and conversion', () => {
    expect(lineTotal(dec('20'), dec('157.50')).toString()).toBe('3150');
    expect(applyDiscount(dec('5150.00'), dec('0.05')).toString()).toBe('4892.5');
    expect(convert(dec('100'), { from: 'GBP', to: 'MXN', value: dec('23.4567') }).toString()).toBe('2345.67');
    expect(() => convert(dec('100'), { from: 'GBP', to: 'MXN', value: dec('0') })).toThrow(QuoteEngineError);
  });

  it('rounds half-up and half-even at explicit points', () => {
    expect(roundMoney(dec('2.345'), 2).toString()).toBe('2.35');
    expect(roundMoney(dec('2.345'), 2, 'HALF_EVEN').toString()).toBe('2.34');
  });

  it('rejects non-decimal input', () => {
    expect(() => dec('1e3')).toThrow(QuoteEngineError);
    expect(() => dec('abc')).toThrow(QuoteEngineError);
  });

  it('hash is stable regardless of key order', () => {
    const a = calculationHash({ b: '1', a: ['x', { d: 2, c: 1 }] });
    const b = calculationHash({ a: ['x', { c: 1, d: 2 }], b: '1' });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
