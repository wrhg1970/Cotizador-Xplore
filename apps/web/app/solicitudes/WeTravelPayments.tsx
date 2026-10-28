'use client';

import { useState } from 'react';
import { api, errorText } from '../lib/api';
import { fmtDateTime } from '../lib/types';

interface LinkPayments {
  collected: Record<string, number>;
  payments: number;
  payers: number;
  lastPaymentAt: string | null;
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, currencyDisplay: 'code' }).format(
    cents / 100,
  );

/** Collected so far through the WeTravel link, read live on demand. */
export function WeTravelPayments({ requestId }: { requestId: string }) {
  const [data, setData] = useState<LinkPayments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setData(await api<LinkPayments>(`/requests/${requestId}/wetravel/payments`));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {data && (
        <span>
          {Object.entries(data.collected)
            .map(([c, v]) => money(v, c))
            .join(' · ') || 'Sin pagos'}{' '}
          <span className="muted">
            ({data.payments} pagos de {data.payers} personas
            {data.lastPaymentAt && `; último ${fmtDateTime(data.lastPaymentAt)}`})
          </span>{' '}
        </span>
      )}
      <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>
        {data ? 'Actualizar' : 'Ver pagos en WeTravel'}
      </button>
      {error && (
        <span className="error" role="alert">
          {' '}
          {error}
        </span>
      )}
    </>
  );
}
