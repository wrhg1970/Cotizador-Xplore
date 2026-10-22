import { describe, expect, it } from 'vitest';
import { D, dec } from './money.js';
import { calculateQuote, type QuoteInput } from './quote.js';

/** One tab of Finance's "ITALIA SPRING BREAK 2027" sheet, expressed as quote lines. */
function option(o: {
  participants: number;
  staff: number;
  netPrice: string;
  kit: string;
  margin: string;
}): QuoteInput {
  const line = (category: QuoteInput['lines'][number]['category'], quantity: string, unitCost: string) => ({
    category,
    quantity: dec(quantity),
    unitCost: dec(unitCost),
    currency: 'EUR',
  });
  return {
    saleCurrency: 'EUR',
    participants: o.participants,
    chaperones: 0,
    staff: o.staff,
    targetMarginRate: dec(o.margin),
    fxRates: {},
    lines: [
      line('PER_PARTICIPANT', '1', o.netPrice),
      line('PER_PARTICIPANT', '1', o.kit),
      line('PER_PARTICIPANT', '1', '20'), // Promoción
      line('PER_PARTICIPANT', '1', '10'), // Costo envíos kits
      line('PER_PARTICIPANT', '1', '40'), // Operación
      line('PER_STAFF', '16', '50'), // Viáticos: 50/día × 16 días
      line('PER_STAFF', '1', o.kit), // Kit del chaperón EE
      line('CONTINGENCY', '1', '150'), // Fondo de emergencia
    ],
  };
}

// Expected values are the sheet's own results (Consolidado, rows "Gastos del líder", "Comisión", "PRECIO FINAL").
const sheet = [
  {
    participants: 10,
    staff: 2,
    netPrice: '3900',
    kit: '50',
    margin: '0.18',
    leader: '185',
    commission: '923.0487805',
    price: '5128.04878',
  },
  {
    participants: 15,
    staff: 2,
    netPrice: '3400',
    kit: '50',
    margin: '0.2',
    leader: '123.3333333',
    commission: '910.8333333',
    price: '4554.166667',
  },
  {
    participants: 20,
    staff: 3,
    netPrice: '3200',
    kit: '50',
    margin: '0.2',
    leader: '135',
    commission: '863.75',
    price: '4318.75',
  },
  {
    participants: 12,
    staff: 1,
    netPrice: '3500',
    kit: '30',
    margin: '0.157',
    leader: '81.66666667',
    commission: '685.6722025',
    price: '4367.338869',
  },
  {
    participants: 10,
    staff: 1,
    netPrice: '3000',
    kit: '30',
    margin: '0.16',
    leader: '98',
    commission: '609.1428571',
    price: '3807.142857',
  },
];

describe('calculateQuote reproduces Finance sheet', () => {
  it.each(sheet)('option with $participants participants', (o) => {
    const r = calculateQuote(option(o));
    const close = (a: InstanceType<typeof D>, b: string) =>
      expect(a.minus(b).abs().lt('0.000001')).toBe(true);
    close(r.sharedPerParticipant, o.leader);
    close(r.marginPerParticipant, o.commission);
    close(r.pricePerParticipant, o.price);
  });

  it('group margin is per-participant margin × participants (sheet "Margen Estimado")', () => {
    const r = calculateQuote(option(sheet[0]!));
    expect(r.groupMargin.minus('9230.487805').abs().lt('0.00001')).toBe(true);
  });

  it('converts line currencies with the recorded rate and fails without one', () => {
    const q = option(sheet[0]!);
    q.lines.push({ category: 'PER_GROUP', quantity: dec('1'), unitCost: dec('2039'), currency: 'MXN' });
    expect(() => calculateQuote(q)).toThrow(/MXN → EUR/);
    q.fxRates.MXN = dec('0.05');
    // 2039 MXN × 0.05 = 101.95 EUR more in shared costs, spread over 10.
    expect(calculateQuote(q).sharedPerParticipant.toString()).toBe('195.195');
  });

  it('chaperone lines scale by chaperones', () => {
    const q = { ...option(sheet[0]!), chaperones: 2 };
    q.lines.push({ category: 'PER_CHAPERONE', quantity: dec('1'), unitCost: dec('100'), currency: 'EUR' });
    expect(calculateQuote(q).sharedTotal.toString()).toBe('2050');
  });
});
