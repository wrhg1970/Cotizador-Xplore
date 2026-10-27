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
 * Per-student schedule for a final price: optional registration, then equal installments rounded down
 * to cents; the last one takes the remainder so the schedule always adds up to the price exactly.
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
  const each = rest.div(plan.installments).toDecimalPlaces(2, D.ROUND_DOWN);
  for (let i = 0; i < plan.installments; i++) {
    const last = i === plan.installments - 1;
    payments.push({
      number: i + 1,
      dueDate:
        plan.frequency === 'MONTHLY'
          ? addMonths(plan.firstDueDate, i)
          : addDays(plan.firstDueDate, i * (plan.frequency === 'BIWEEKLY' ? 14 : 7)),
      amount: last ? rest.minus(each.mul(plan.installments - 1)) : each,
    });
  }
  return payments;
}

/** "1 lugar liberado por cada N estudiantes"; informative until Finance defines how it prices. */
export const freePlaces = (participants: number, studentsPerFreePlace: number) =>
  Math.floor(participants / studentsPerFreePlace);
