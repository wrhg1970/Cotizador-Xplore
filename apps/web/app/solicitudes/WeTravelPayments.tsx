'use client';

import { useState } from 'react';
import { api, errorText } from '../lib/api';
import { thousands } from '../lib/format';
import { fmtDateTime } from '../lib/types';

interface OrderBalance {
  students: string;
  count: number;
  payer: string;
  price: number;
  paid: number;
  balance: number;
}
interface TripBalances {
  tripUuid: string;
  currency: string | null;
  orders: OrderBalance[];
}

// WeTravel amounts are integer cents; every currency it accepts has 2 decimals.
const money = (cents: number) => thousands((cents / 100).toFixed(2));

/** Price, paid and balance per student, read live from the sold proposal's WeTravel trip. */
export function WeTravelPayments({ requestId }: { requestId: string }) {
  const [data, setData] = useState<(TripBalances & { at: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<TripBalances>(`/requests/${requestId}/wetravel/balances`);
      setData({ ...res, at: new Date().toISOString() });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const sum = (k: 'price' | 'paid' | 'balance') => data!.orders.reduce((a, o) => a + o[k], 0);
  return (
    <>
      <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>
        {busy ? 'Leyendo…' : data ? 'Actualizar' : 'Ver saldos'}
      </button>
      {data && <small className="muted"> Leído {fmtDateTime(data.at)}</small>}
      {error && (
        <span className="error" role="alert">
          {' '}
          {error}
        </span>
      )}
      {data &&
        (data.orders.length ? (
          <table className="tray" aria-label="Saldos en WeTravel">
            <thead>
              <tr>
                <th>Estudiante</th>
                <th>Pagó</th>
                <th className="num">Precio</th>
                <th className="num">Pagado</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o, i) => (
                <tr key={i}>
                  <td>{o.students}</td>
                  <td className="muted">{o.payer}</td>
                  <td className="num">{money(o.price)}</td>
                  <td className="num">{money(o.paid)}</td>
                  <td className={`num ${o.balance ? 'error' : ''}`}>{money(o.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{data.orders.reduce((a, o) => a + o.count, 0)} estudiantes</th>
                <th />
                <th className="num">{money(sum('price'))}</th>
                <th className="num">{money(sum('paid'))}</th>
                <th className="num">
                  {money(sum('balance'))} {data.currency ?? ''}
                </th>
              </tr>
            </tfoot>
          </table>
        ) : (
          <small className="muted"> Aún no hay reservas en el viaje de WeTravel.</small>
        ))}
    </>
  );
}
