/**
 * WeTravel Partner API v3 (https://developer.wetravel.com/v3). Only what the docs publish:
 * POST {base}/auth/tokens/access with the Partner API key as Bearer returns a 1 h access token;
 * POST {base}/payment_links creates a payment link whose `uuid` and `checkout_url` we keep.
 */
export interface PaymentLinkBody {
  title: string;
  external_id: string;
  start_date: string;
  end_date: string;
  currency: string;
  participant_fees: 'none' | 'credit_card' | 'service' | 'all';
  package: {
    price: number;
    deposit?: number;
    payment_plan?: {
      allow_auto_payment: boolean;
      allow_partial_payment: boolean;
      installments: { amount: number; days_before_departure: number }[];
    };
  };
}

export interface PaymentLink {
  uuid: string;
  checkoutUrl: string;
}

/** Money collected for one payment link, per currency in minor units (cents), refunds already subtracted. */
export interface LinkPayments {
  /** e.g. { USD: 1250000 } = 12,500.00 USD */
  collected: Record<string, number>;
  payments: number;
  payers: number;
  lastPaymentAt: string | null;
}

/** Seam for tests; null in the container means WeTravel is not configured. */
export interface WeTravel {
  createPaymentLink(body: PaymentLinkBody): Promise<PaymentLink>;
  linkPayments(linkUuid: string): Promise<LinkPayments>;
}

interface Transaction {
  amount?: number;
  refunded_amount?: number;
  currency?: string;
  status?: string;
  created_at?: string;
  buyer?: { email?: string };
}

/** Pure sum over WeTravel transactions (type payment): amount minus refunds, failed ones skipped. */
export function sumPayments(txs: Transaction[]): LinkPayments {
  const collected: Record<string, number> = {};
  const payers = new Set<string>();
  let payments = 0;
  let last: string | null = null;
  for (const t of txs) {
    if (!t.currency || typeof t.amount !== 'number') continue;
    if (t.status && /fail|declin|cancel|void/i.test(t.status)) continue;
    const c = t.currency.toUpperCase();
    collected[c] = (collected[c] ?? 0) + t.amount - (t.refunded_amount ?? 0);
    payments++;
    if (t.buyer?.email) payers.add(t.buyer.email.toLowerCase());
    if (t.created_at && (!last || t.created_at > last)) last = t.created_at;
  }
  return { collected, payments, payers: payers.size, lastPaymentAt: last };
}
export const WETRAVEL = Symbol('WETRAVEL');

export class WeTravelError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface LinkSource {
  folio: string;
  groupName: string;
  departureDate: string;
  returnDate: string;
  currency: string;
  /** Per participant, 2 decimals, e.g. "5129.00". */
  price: string;
  /** Payment 0 is the registration deposit; null when the version has no plan. */
  schedule: { number: number; dueDate: string; amount: string }[] | null;
}

// Every sale currency we allow (MXN, USD, EUR, GBP, CAD, AUD) has 2 decimals; WeTravel wants minor units.
const cents = (amount: string) => {
  const [int, frac = ''] = amount.split('.');
  return Number(int) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
};
const daysBefore = (departure: string, due: string) =>
  Math.round((Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);

/** Maps the winning proposal to WeTravel's payload; the client sees the same price as in the PDF. */
export function paymentLinkBody(s: LinkSource): PaymentLinkBody {
  const body: PaymentLinkBody = {
    title: `${s.groupName} (${s.folio})`.slice(0, 255),
    external_id: s.folio,
    start_date: s.departureDate,
    end_date: s.returnDate,
    currency: s.currency,
    // Fees on top would make the parent pay more than the proposal says.
    participant_fees: 'none',
    package: { price: cents(s.price) },
  };
  if (s.schedule?.length) {
    const deposit = s.schedule.find((p) => p.number === 0);
    const installments = s.schedule
      .filter((p) => p.number > 0)
      .map((p) => ({
        amount: cents(p.amount),
        days_before_departure: daysBefore(s.departureDate, p.dueDate),
      }));
    if (installments.some((i) => i.days_before_departure < -545 || i.days_before_departure > 900))
      throw new WeTravelError(400, 'WeTravel acepta pagos de hasta 900 días antes de la salida');
    body.package.deposit = deposit ? cents(deposit.amount) : 0;
    body.package.payment_plan = { allow_auto_payment: false, allow_partial_payment: false, installments };
  }
  return body;
}

export class HttpWeTravel implements WeTravel {
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const res = await fetch(`${this.baseUrl}/auth/tokens/access`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new WeTravelError(res.status, 'WeTravel rechazó la llave de API');
    const { access_token } = (await res.json()) as { access_token?: string };
    if (!access_token) throw new WeTravelError(502, 'WeTravel no devolvió token de acceso');
    // Docs: valid 1 h; renew 5 min early.
    this.token = { value: access_token, until: Date.now() + 55 * 60_000 };
    return access_token;
  }

  async createPaymentLink(body: PaymentLinkBody): Promise<PaymentLink> {
    const res = await fetch(`${this.baseUrl}/payment_links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      if (res.status === 401) this.token = null;
      throw new WeTravelError(res.status, `WeTravel respondió ${res.status} al crear la liga de pago`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    // The v3 reference does not say whether the body is wrapped in `data` (v2 was); accept both.
    const link = (json.data ?? json) as { uuid?: string; checkout_url?: string };
    if (!link.uuid || !link.checkout_url) throw new WeTravelError(502, 'Respuesta de WeTravel sin liga');
    return { uuid: link.uuid, checkoutUrl: link.checkout_url };
  }

  private async call(url: string, init: { method?: string; body?: unknown } = {}) {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      if (res.status === 401) this.token = null;
      throw new WeTravelError(res.status, `WeTravel respondió ${res.status} al leer los pagos`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    return json;
  }

  /**
   * GET {base}/payment_links/{uuid} gives the link's trip uuid; POST /v2/transactions (the reference
   * lists it under v2 and the v3 release says Transactions did not change) filtered by that trip and
   * type `payment` gives what was collected. Amounts are integers in minor units.
   */
  async linkPayments(linkUuid: string): Promise<LinkPayments> {
    const link = await this.call(`${this.baseUrl}/payment_links/${encodeURIComponent(linkUuid)}`);
    const trip = ((link.data ?? link) as { trip?: { uuid?: string } }).trip;
    const tripUuid = trip?.uuid ?? linkUuid;
    const transactions = `${new URL(this.baseUrl).origin}/v2/transactions`;
    const all: Transaction[] = [];
    // shortcut: at most 5 pages of 1000; a single school group never gets close.
    for (let page = 1; page <= 5; page++) {
      const res = await this.call(transactions, {
        method: 'POST',
        body: { page, per_page: 1000, filters: { trip_uuids: [tripUuid], transaction_type: 'payment' } },
      });
      all.push(...((res.data as Transaction[] | undefined) ?? []));
      if (!(res.pagination as { has_next?: boolean } | undefined)?.has_next) break;
    }
    return sumPayments(all);
  }
}
