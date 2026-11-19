import { D, type Dec, QuoteEngineError } from './money.js';

export type Frequency = 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';

export interface PaymentPlan {
  /** Share of the price due at registration (0 ≤ rate < 1); exclusive with `depositAmount`. */
  depositRate?: Dec | null;
  /** Fixed registration amount in the sale currency; must be below the price. */
  depositAmount?: Dec | null;
  depositDueDate?: string | null;
  installments: number;
  frequency: Frequency;
  firstDueDate: string;
  /** Installments edited by hand (1..n): a fixed amount and/or date; the others share what is left. */
  overrides?: PaymentOverride[] | null;
}

export interface PaymentOverride {
  number: number;
  amount?: Dec | null;
  dueDate?: string | null;
}

export interface Payment {
  /** 0 = registration, then 1..n. */
  number: number;
  dueDate: string;
  amount: Dec;
}

/** Adds whole months in UTC, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Per-student schedule for a final price: optional registration, then installments. Hand-edited amounts
 * stay fixed; the rest is split equally, rounded down to cents, and the last free installment takes the
 * remainder so the schedule always adds up to the price exactly (or it throws).
 */
export function paymentSchedule(price: Dec, plan: PaymentPlan): Payment[] {
  if (!Number.isInteger(plan.installments) || plan.installments < 1 || plan.installments > 15)
    throw new QuoteEngineError('INVALID_AMOUNT', 'Entre 1 y 15 parcialidades');
  const deposit = plan.depositAmount
    ? plan.depositAmount
    : plan.depositRate
      ? price.mul(plan.depositRate).toDecimalPlaces(2, D.ROUND_DOWN)
      : new D(0);
  if (deposit.isNegative() || (deposit.gt(0) && deposit.gte(price)))
    throw new QuoteEngineError('INVALID_AMOUNT', 'La inscripción debe ser menor que el precio');

  const payments: Payment[] = [];
  if (deposit.gt(0)) {
    if (!plan.depositDueDate) throw new QuoteEngineError('INVALID_AMOUNT', 'Falta la fecha de inscripción');
    payments.push({ number: 0, dueDate: plan.depositDueDate, amount: deposit });
  }
  const rest = price.minus(deposit);
  const byNumber = new Map((plan.overrides ?? []).map((o) => [o.number, o]));
  const fixed = (n: number) => byNumber.get(n)?.amount ?? null;
  const numbers = Array.from({ length: plan.installments }, (_, i) => i + 1);
  const free = numbers.filter((n) => !fixed(n));
  const left = numbers.reduce((a, n) => a.minus(fixed(n) ?? 0), rest);
  if (left.isNegative())
    throw new QuoteEngineError(
      'INVALID_AMOUNT',
      `Los pagos editados se pasan del precio por ${left.abs().toFixed(2)}`,
    );
  if (free.length && left.isZero())
    throw new QuoteEngineError(
      'INVALID_AMOUNT',
      'Los pagos editados ya suman el precio; no queda saldo para los demás',
    );
  if (!free.length && !left.isZero())
    throw new QuoteEngineError(
      'INVALID_AMOUNT',
      `Los pagos editados no cubren el precio: faltan ${left.toFixed(2)}`,
    );
  const each = free.length ? left.div(free.length).toDecimalPlaces(2, D.ROUND_DOWN) : new D(0);
  const lastFree = free[free.length - 1];
  for (const n of numbers) {
    const i = n - 1;
    payments.push({
      number: n,
      dueDate:
        byNumber.get(n)?.dueDate ??
        (plan.frequency === 'MONTHLY'
          ? addMonths(plan.firstDueDate, i)
          : addDays(plan.firstDueDate, i * (plan.frequency === 'BIWEEKLY' ? 14 : 7))),
      amount: fixed(n) ?? (n === lastFree ? left.minus(each.mul(free.length - 1)) : each),
    });
  }
  return payments;
}

/** "1 gratuidad por cada N estudiantes" (Gratuidades por ratio); calculateQuote frees chaperones' course with them. */
export const freePlaces = (participants: number, studentsPerFreePlace: number) =>
  Math.floor(participants / studentsPerFreePlace);
