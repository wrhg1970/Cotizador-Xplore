import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpWeTravel, paymentLinkBody, WeTravelError } from './wetravel.js';

const base = {
  folio: 'EE-2027-0001',
  groupName: 'Roma 2027',
  departureDate: '2027-03-19',
  returnDate: '2027-03-25',
  currency: 'USD',
  price: '5129.00',
  schedule: null,
};

describe('paymentLinkBody', () => {
  it('sends the per-participant price in cents, no fees on top, folio as external id', () => {
    expect(paymentLinkBody(base)).toEqual({
      title: 'Roma 2027 (EE-2027-0001)',
      external_id: 'EE-2027-0001',
      start_date: '2027-03-19',
      end_date: '2027-03-25',
      currency: 'USD',
      participant_fees: 'none',
      package: { price: 512900 },
    });
  });

  it('maps the schedule: payment 0 is the deposit, the rest count days back from departure', () => {
    const body = paymentLinkBody({
      ...base,
      price: '1000.50',
      schedule: [
        { number: 0, dueDate: '2026-11-15', amount: '150.05' },
        { number: 1, dueDate: '2027-01-19', amount: '425.22' },
        { number: 2, dueDate: '2027-02-19', amount: '425.23' },
      ],
    });
    expect(body.package).toEqual({
      price: 100050,
      deposit: 15005,
      payment_plan: {
        allow_auto_payment: false,
        allow_partial_payment: false,
        installments: [
          { amount: 42522, days_before_departure: 59 },
          { amount: 42523, days_before_departure: 28 },
        ],
      },
    });
    const { deposit, payment_plan } = body.package;
    expect(deposit! + payment_plan!.installments.reduce((s, i) => s + i.amount, 0)).toBe(100050);
  });

  it('refuses due dates WeTravel cannot express', () => {
    expect(() =>
      paymentLinkBody({ ...base, schedule: [{ number: 1, dueDate: '2024-01-01', amount: '5129.00' }] }),
    ).toThrow(WeTravelError);
  });
});

describe('HttpWeTravel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('trades the API key for an access token, reuses it, and reads uuid and checkout_url', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, auth: new Headers(init.headers).get('authorization') });
        return url.endsWith('/auth/tokens/access')
          ? Response.json({ access_token: 'acc' }, { status: 201 })
          : Response.json(
              { data: { uuid: 'u1', checkout_url: 'https://wetravel.com/checkout/u1' } },
              { status: 201 },
            );
      }),
    );
    const wt = new HttpWeTravel('https://api.demo.wetravel.to/v3', 'key');
    expect(await wt.createPaymentLink(paymentLinkBody(base))).toEqual({
      uuid: 'u1',
      checkoutUrl: 'https://wetravel.com/checkout/u1',
    });
    await wt.createPaymentLink(paymentLinkBody(base));
    expect(calls).toEqual([
      { url: 'https://api.demo.wetravel.to/v3/auth/tokens/access', auth: 'Bearer key' },
      { url: 'https://api.demo.wetravel.to/v3/payment_links', auth: 'Bearer acc' },
      { url: 'https://api.demo.wetravel.to/v3/payment_links', auth: 'Bearer acc' },
    ]);
  });

  it('reports a rejected key without echoing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 })),
    );
    const err = await new HttpWeTravel('https://x.example/v3', 'secret-key')
      .createPaymentLink(paymentLinkBody(base))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WeTravelError);
    expect((err as Error).message).not.toContain('secret-key');
  });
});
