import { describe, expect, it } from 'vitest';
import { thousands } from './money.js';

describe('thousands', () => {
  it('adds commas to the integer part only, keeping the exact decimals', () => {
    expect(thousands('42828.00')).toBe('42,828.00');
    expect(thousands('1935679.0512')).toBe('1,935,679.0512');
    expect(thousands('-12500.5')).toBe('-12,500.5');
    expect(thousands(1234567)).toBe('1,234,567');
  });
  it('leaves short numbers and non-numbers as they are', () => {
    expect(thousands('999.99')).toBe('999.99');
    expect(thousands('0')).toBe('0');
    expect(thousands('2026-12-01')).toBe('2026-12-01');
    expect(thousands('—')).toBe('—');
    expect(thousands('12,500.00')).toBe('12,500.00');
    expect(thousands('')).toBe('');
    expect(thousands(undefined)).toBe('');
  });
});
