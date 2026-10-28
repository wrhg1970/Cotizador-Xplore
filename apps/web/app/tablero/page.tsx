'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { fmtDate } from '../lib/types';
import { canExportXlsx, useMe } from '../lib/useMe';
import { type CohortRow, Panel } from './Panel';

interface Bucket {
  requests: number;
  open: number;
  won: number;
  lost: number;
  cancelled: number;
  wonStudents: number;
  wonAmount: Record<string, string>;
  conversion: number | null;
}
interface Executive {
  period: { from: string; to: string };
  totals: Bucket;
  funnel: { stage: 1 | 2 | 3 | 4; count: number }[];
  byOffice: (Bucket & { id: string; code: string; name: string })[];
  monthly: (Bucket & { month: string })[];
  upcoming: {
    id: string;
    folio: string;
    groupName: string;
    officeCode: string;
    departureDate: string;
    participants: number;
    chaperones: number;
  }[];
  goals: {
    year: number;
    offices: {
      id: string;
      code: string;
      name: string;
      goalMxn: string;
      wonMxn: string;
      progress: number | null;
      withoutRate: number;
    }[];
  };
  requests: CohortRow[];
}
interface Office {
  id: string;
  code: string;
  name: string;
}

const amounts = (a: Record<string, string>) =>
  Object.entries(a)
    .map(
      ([c, x]) =>
        `${new Intl.NumberFormat('es-MX', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(Number(x))} ${c}`,
    )
    .join(' · ') || '—';
const pct = (x: number | null) => (x === null ? '—' : `${x}%`);
// Display only: the API keeps the exact decimal.
const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });

/** V2 executive dashboard: cohort of requests created in the period, client prices only. */
export default function ExecutivePage() {
  const me = useMe();
  const canExport = !!me?.roles.some((r) => canExportXlsx(me, r.officeId));
  const [offices, setOffices] = useState<Office[]>([]);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<Executive | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Office[]>('/offices').then(setOffices, () => undefined);
  }, []);
  useEffect(() => {
    setError(null);
    api<Executive>(`/dashboard/executive${query}`).then(setData, (e) => setError(errorText(e)));
  }, [query]);

  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p = new URLSearchParams();
    for (const k of ['officeId', 'from', 'to']) if (f.get(k)) p.set(k, String(f.get(k)));
    setQuery(p.size ? `?${p}` : '');
  }

  /** Plain navigation: same-origin download carries the session cookie. Empty fields use the server's defaults. */
  function download(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p = new URLSearchParams();
    for (const k of ['officeId', 'from', 'to']) if (f.get(k)) p.set(k, String(f.get(k)));
    window.location.assign(`/api/v1/reports/financial.xlsx${p.size ? `?${p}` : ''}`);
  }

  const t = data?.totals;

  return (
    <>
      <div className="dx-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>Dashboard ejecutivo</h1>
          <p className="muted" style={{ margin: 0 }}>
            Panel comercial y financiero · solicitudes creadas en el periodo, sin borradores
          </p>
        </div>
        <Link className="button" href="/solicitudes/nueva">
          + Nueva solicitud
        </Link>
      </div>
      <form className="row card" onSubmit={apply} style={{ margin: '16px 0' }}>
        <label>
          Oficina
          <select name="officeId" defaultValue="">
            <option value="">Todas las de mi alcance</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Creadas desde
          <input name="from" type="date" defaultValue={data?.period.from} key={`f${data?.period.from}`} />
        </label>
        <label>
          hasta
          <input name="to" type="date" defaultValue={data?.period.to} key={`t${data?.period.to}`} />
        </label>
        <button className="secondary">Aplicar</button>
      </form>
      {canExport && (
        <details className="card" style={{ marginBottom: 16 }}>
          <summary>Reporte financiero (uso interno, con costos y comisión)</summary>
          <form className="row" onSubmit={download} style={{ marginTop: 8 }}>
            <label>
              Oficina
              <select name="officeId" defaultValue="">
                <option value="">Todas las que puedo exportar</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} · {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Salidas desde
              <input name="from" type="date" />
            </label>
            <label>
              Salidas hasta
              <input name="to" type="date" />
            </label>
            <button className="secondary">Descargar Excel</button>
          </form>
          <p className="muted">Viajes ganados por fecha de salida; si no eliges fechas, el año en curso.</p>
        </details>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && t && (
        <>
          <Panel rows={data.requests} to={data.period.to} />
          <div className="dx-two">
            <div className="card stage">
              <div className="eyebrow">Monto ganado (precio al cliente)</div>
              <div className="count">{amounts(t.wonAmount)}</div>
              <div className="muted">
                {t.won} ganadas · {t.wonStudents} alumnos. Cada moneda por separado; no se convierten tipos de
                cambio.
              </div>
            </div>
            <section className="card" aria-labelledby="salidas">
              <h2 id="salidas" style={{ marginTop: 0 }}>
                Salidas ganadas en 60 días
              </h2>
              {data.upcoming.length === 0 ? (
                <p className="muted">Ninguna.</p>
              ) : (
                <ol className="timeline">
                  {data.upcoming.map((u) => (
                    <li key={u.id}>
                      <strong>{fmtDate(u.departureDate)}</strong> ·{' '}
                      <Link href={`/solicitudes/${u.id}`}>{u.folio}</Link> · {u.groupName} · {u.officeCode} ·{' '}
                      {u.participants} alum. + {u.chaperones} chap.
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          {data.goals.offices.length > 0 && (
            <section className="card" aria-labelledby="metas" style={{ marginTop: 16 }}>
              <h2 id="metas" style={{ marginTop: 0 }}>
                Meta anual {data.goals.year}
              </h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Oficina</th>
                      <th className="num">Meta (MXN)</th>
                      <th className="num">Ganado (MXN)</th>
                      <th>Avance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.goals.offices.map((o) => (
                      <tr key={o.id}>
                        <th scope="row">
                          {o.code} · {o.name}
                        </th>
                        <td className="num">{mxn.format(Number(o.goalMxn))}</td>
                        <td className="num">
                          {mxn.format(Number(o.wonMxn))}
                          {o.withoutRate > 0 && (
                            <div className="muted">+ {o.withoutRate} sin tipo de cambio a MXN</div>
                          )}
                        </td>
                        <td>
                          <progress
                            max={100}
                            value={Math.min(100, o.progress ?? 0)}
                            aria-label={`Avance ${o.code}`}
                          />{' '}
                          {o.progress === null ? '—' : `${o.progress}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card" aria-labelledby="por-oficina" style={{ marginTop: 16 }}>
            <h2 id="por-oficina" style={{ marginTop: 0 }}>
              Por oficina
            </h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Oficina</th>
                    <th className="num">Solicitudes</th>
                    <th className="num">Abiertas</th>
                    <th className="num">Ganadas</th>
                    <th className="num">Perdidas</th>
                    <th className="num">Conversión</th>
                    <th>Monto ganado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byOffice.map((o) => (
                    <tr key={o.id}>
                      <th scope="row">
                        {o.code} · {o.name}
                      </th>
                      <td className="num">{o.requests}</td>
                      <td className="num">{o.open}</td>
                      <td className="num">{o.won}</td>
                      <td className="num">{o.lost}</td>
                      <td className="num">{pct(o.conversion)}</td>
                      <td>{amounts(o.wonAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
