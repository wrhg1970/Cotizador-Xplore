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

/** One WeTravel order (a family's purchase) of a trip; amounts in minor units (cents). */
export interface OrderBalance {
  /** Active travelers, e.g. "Sofía y Mateo Cantú"; the buyer's name when WeTravel lists none. */
  students: string;
  count: number;
  payer: string;
  price: number;
  paid: number;
  balance: number;
}

export interface TripBalances {
  currency: string | null;
  orders: OrderBalance[];
}

/** Seam for tests; null in the container means WeTravel is not configured. */
export interface WeTravel {
  createPaymentLink(body: PaymentLinkBody): Promise<PaymentLink>;
  /** Price, paid and balance of every order of the trip (v2 bookings; read live, never stored). */
  tripBalances(tripUuid: string): Promise<TripBalances>;
  /** The trip a payment link created from the cotizador belongs to. */
  linkTrip(linkUuid: string): Promise<string>;
  /** Upcoming, not archived trips of the account, by departure; `query` searches title or external id. */
  listTrips(query?: string): Promise<WeTravelTrip[]>;
  /** The trip's itinerary as proposal days (GET /trips/{uuid}/itinerary). */
  tripItinerary(uuid: string): Promise<{ day: number; title: string; details?: string }[]>;
}

export interface WeTravelTrip {
  uuid: string;
  title: string;
  /** Public trip page, e.g. https://www.wetravel.com/trips/epic-london-trip-12345678 */
  url: string;
  startDate: string | null;
  endDate: string | null;
}

/** Only https pages on wetravel.com (or a subdomain) are ever stored or shown to the school. */
export const isWeTravelUrl = (u: unknown): u is string => {
  try {
    const url = new URL(String(u));
    return (
      url.protocol === 'https:' && (url.hostname === 'wetravel.com' || url.hostname.endsWith('.wetravel.com'))
    );
  } catch {
    return false;
  }
};

export function toTrip(t: Record<string, unknown>): WeTravelTrip | null {
  if (typeof t.uuid !== 'string' || typeof t.title !== 'string' || !isWeTravelUrl(t.url)) return null;
  const date = (d: unknown) =>
    typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  return {
    uuid: t.uuid,
    title: t.title.slice(0, 255),
    url: t.url,
    startDate: date(t.start_date),
    endDate: date(t.end_date),
  };
}

interface ItinerarySection {
  type?: string;
  title?: string;
  headline?: string;
  hidden_from_traveler?: boolean;
  items?: { title?: string; hidden_from_traveler?: boolean }[];
}

const plain = (s: unknown) =>
  typeof s === 'string'
    ? s
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

/**
 * WeTravel itinerary → proposal days: each visible "general" section is a day (its title), its visible
 * item titles the detail. Other section types (map, organizer, inclusions…) are not days.
 */
export function itineraryDays(body: { sections?: ItinerarySection[] }) {
  return (body.sections ?? [])
    .filter((s) => s.type === 'general' && !s.hidden_from_traveler)
    .slice(0, 120)
    .map((s, i) => {
      const details = (s.items ?? [])
        .filter((it) => !it.hidden_from_traveler)
        .map((it) => plain(it.title))
        .filter(Boolean)
        .join(' · ')
        .slice(0, 2000);
      return {
        day: i + 1,
        title: (plain(s.title) || plain(s.headline) || `Día ${i + 1}`).slice(0, 200),
        ...(details ? { details } : {}),
      };
    });
}

interface Participant {
  first_name?: string;
  last_name?: string;
  cancelled?: boolean;
}
export interface WtOrder {
  currency?: string;
  total_amount?: number;
  paid_amount?: number;
  already_paid?: number;
  options?: { participants?: Participant[] }[];
}

const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** "Ana Garza", or "Sofía y Mateo Cantú" when siblings share a last name. */
export function studentNames(ps: Participant[]): string[] {
  const names = ps
    .filter((p) => !p.cancelled)
    .map((p) => ({ first: (p.first_name ?? '').trim(), last: (p.last_name ?? '').trim() }))
    .filter((p) => p.first || p.last);
  const lasts = new Set(names.map((n) => n.last));
  if (names.length > 1 && lasts.size === 1) {
    const firsts = names.map((n) => n.first);
    return [`${firsts.slice(0, -1).join(', ')} y ${firsts.at(-1)} ${names[0]!.last}`.trim()];
  }
  return names.map((n) => `${n.first} ${n.last}`.trim());
}

/**
 * Pure: one row per order. Paid is `already_paid` (all money registered, cash included) or
 * `paid_amount`; balance = price − paid, never below 0, so the columns always add up.
 * Orders whose travelers were all cancelled and owe nothing are left out.
 */
export function orderBalance(o: WtOrder, payer: string): OrderBalance | null {
  const ps = (o.options ?? []).flatMap((op) => op.participants ?? []);
  const names = studentNames(ps);
  const active = ps.filter((p) => !p.cancelled).length;
  const price = num(o.total_amount);
  const paid = typeof o.already_paid === 'number' ? num(o.already_paid) : num(o.paid_amount);
  const balance = Math.max(0, price - paid);
  if (ps.length && !active && !balance) return null;
  return {
    students: (names.join(', ') || payer).slice(0, 300),
    count: active,
    payer: payer.slice(0, 200),
    price,
    paid,
    balance,
  };
}

export const WETRAVEL = Symbol('WETRAVEL');

/** First error text in a WeTravel error body, one line, at most 200 chars; never the whole payload. */
export async function wetravelReason(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const errors = body?.errors;
  const first = Array.isArray(errors) ? errors[0] : errors;
  const raw =
    body?.message ?? body?.error ?? (typeof first === 'object' && first ? JSON.stringify(first) : first);
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').slice(0, 200) : '';
}

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

  private async call(url: string, step: string, init: { method?: string; body?: unknown } = {}) {
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
      // WeTravel's own reason (e.g. a rejected filter) is what tells us what to fix.
      const why = await wetravelReason(res);
      throw new WeTravelError(
        res.status,
        `WeTravel respondió ${res.status} al ${step}${why ? `: ${why}` : ''}`,
      );
    }
    const json = (await res.json()) as Record<string, unknown>;
    return json;
  }

  async linkTrip(linkUuid: string): Promise<string> {
    const link = await this.call(
      `${this.baseUrl}/payment_links/${encodeURIComponent(linkUuid)}`,
      'leer la liga de pago',
    );
    const uuid = ((link.data ?? link) as { trip?: { uuid?: string } }).trip?.uuid;
    if (!uuid) throw new WeTravelError(502, 'WeTravel no dijo a qué viaje pertenece la liga');
    return uuid;
  }

  /**
   * Bookings are still Partner API v2 (the v3 release left them unchanged), so the paths hang from
   * {origin}/v2 whatever WETRAVEL_API_URL says. GET …/trips/{uuid}/bookings lists orders (with buyer,
   * no travelers); GET …/trips/{uuid}/bookings/{buyer_id} gives that buyer's full orders with travelers.
   */
  async tripBalances(tripUuid: string): Promise<TripBalances> {
    const trip = `${new URL(this.baseUrl).origin}/v2/bookings/trips/${encodeURIComponent(tripUuid)}`;
    const buyers = new Map<string, string>();
    // shortcut: at most 10 pages of 100 orders; a school group never gets close.
    for (let page = 1; page <= 10; page++) {
      const res = await this.call(`${trip}/bookings?page=${page}`, 'leer las reservas');
      for (const o of (res.data as Record<string, unknown>[] | undefined) ?? []) {
        const buyer = o.buyer as { id?: unknown; full_name?: string } | undefined;
        const id = String(buyer?.id ?? o.buyer_id ?? '');
        if (id) buyers.set(id, buyer?.full_name?.trim() || 'Sin nombre');
      }
      if (!(res.pagination as { has_next?: boolean } | undefined)?.has_next) break;
    }
    const orders: OrderBalance[] = [];
    let currency: string | null = null;
    const ids = [...buyers.keys()];
    // Five at a time: fast enough for 40 families without hammering WeTravel.
    for (let i = 0; i < ids.length; i += 5) {
      const pages = await Promise.all(
        ids
          .slice(i, i + 5)
          .map((id) => this.call(`${trip}/bookings/${encodeURIComponent(id)}`, 'leer una reserva')),
      );
      pages.forEach((res, j) => {
        for (const o of (res.orders as WtOrder[] | undefined) ?? []) {
          currency ??= o.currency?.toUpperCase() ?? null;
          const row = orderBalance(o, buyers.get(ids[i + j]!)!);
          if (row) orders.push(row);
        }
      });
    }
    orders.sort((a, b) => a.students.localeCompare(b.students, 'es'));
    return { currency, orders };
  }

  async listTrips(query?: string) {
    const q = new URLSearchParams({
      per_page: '50',
      archived: 'false',
      sort_by: 'departure_date',
      sort_order: 'asc',
      ...(query && query.length >= 3 ? { query } : {}),
    });
    const res = await this.call(`${this.baseUrl}/trips?${q}`, 'leer los viajes');
    return ((res.data as Record<string, unknown>[] | undefined) ?? [])
      .map(toTrip)
      .filter((t): t is WeTravelTrip => !!t);
  }

  async tripItinerary(uuid: string) {
    const res = await this.call(
      `${this.baseUrl}/trips/${encodeURIComponent(uuid)}/itinerary`,
      'leer el itinerario',
    );
    return itineraryDays((res.data ?? res) as { sections?: ItinerarySection[] });
  }
}
