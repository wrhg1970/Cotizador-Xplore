'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { amount } from '../aprobaciones/format';
import { api, errorText } from '../lib/api';
import { fmtDate } from '../lib/types';

interface Row {
  id: string;
  label: string;
  participants: number;
  chaperones: number;
  price: string | null;
  groupPrice: string | null;
  currency: string;
  request: {
    id: string;
    folio: string;
    groupName: string;
    clientName: string | null;
    departureDate: string | null;
    closedAt: string | null;
    wetravelUrl: string | null;
  };
}

const TABS = [
  ['UPCOMING', 'Por salir'],
  ['TRAVELED', 'Ya viajaron'],
  ['ALL', 'Todas'],
] as const;
type Tab = (typeof TABS)[number][0];

const group = (r: Row['request']) => (r.clientName ? `${r.clientName} — ${r.groupName}` : r.groupName);
const today = () => new Date().toISOString().slice(0, 10);
const inTab = (tab: Tab, r: Row) =>
  tab === 'ALL' || (tab === 'UPCOMING') === (r.request.departureDate ?? '') >= today();

/** "Propuestas vendidas": the sold version of each request, after "Propuestas enviadas". */
export function SoldTray() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('UPCOMING');
  useEffect(() => {
    api<Row[]>('/reports/versions?status=WON').then(
      (r) =>
        setRows(
          r.sort((a, b) => (a.request.departureDate ?? '').localeCompare(b.request.departureDate ?? '')),
        ),
      (e) => setError(errorText(e)),
    );
  }, []);
  const shown = rows?.filter((r) => inTab(tab, r));

  return (
    <>
      <section className="card tray-head">
        <div>
          <h1>Propuestas vendidas</h1>
          <p className="muted">Viajes concretados: propuesta vendida, aforo, fecha de salida y cobro</p>
        </div>
        <div className="tabs" role="group" aria-label="Filtro">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
              {label} {rows?.filter((r) => inTab(key, r)).length ?? ''}
            </button>
          ))}
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!rows && !error && <p className="muted">Cargando…</p>}
      {shown?.length === 0 && <p className="muted">No hay propuestas vendidas aquí.</p>}
      {!!shown?.length && (
        <div className="table-wrap card flush">
          <table className="tray">
            <thead>
              <tr>
                <th>Folio / Grupo</th>
                <th>Propuesta vendida</th>
                <th className="num">Precio por estudiante</th>
                <th className="num">Aforo</th>
                <th className="num">Total del grupo</th>
                <th>Vendida el</th>
                <th>Salida</th>
                <th>Cobro</th>
                <th className="num">Expediente</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v.id}>
                  <th scope="row">
                    <Link href={`/solicitudes/${v.request.id}`}>{v.request.folio}</Link>
                    <div className="wrap">{group(v.request)}</div>
                  </th>
                  <td>{v.label}</td>
                  <td className="num strong">{amount(v.price, v.currency)}</td>
                  <td className="num">
                    {v.participants} + {v.chaperones}
                  </td>
                  <td className="num">{amount(v.groupPrice, v.currency)}</td>
                  <td>{fmtDate(v.request.closedAt?.slice(0, 10) ?? null)}</td>
                  <td>{fmtDate(v.request.departureDate)}</td>
                  <td>
                    {v.request.wetravelUrl ? (
                      <a className="badge" href={v.request.wetravelUrl} target="_blank" rel="noreferrer">
                        WeTravel
                      </a>
                    ) : (
                      <span className="muted">Sin liga de pago</span>
                    )}
                  </td>
                  <td className="num">
                    <Link className="button secondary" href={`/solicitudes/${v.request.id}`}>
                      Ver expediente →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
