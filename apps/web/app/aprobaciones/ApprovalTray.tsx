'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { amount, rate } from './format';

interface Row {
  id: string;
  status: 'IN_REVIEW' | 'APPROVED';
  scenarioName: string;
  number: number;
  request: {
    id: string;
    folio: string;
    groupName: string;
    clientName: string | null;
    officeName: string;
  };
  participants: number;
  chaperones: number;
  price: string | null;
  groupPrice: string | null;
  currency: string;
  /** Only for roles that see internal costs. */
  marginRate?: string | null;
  signatures: number;
  preparedBy: string;
  canApprove: boolean;
}

const statusText = (v: Row) =>
  v.status === 'APPROVED'
    ? 'Aprobado'
    : v.signatures
      ? `Pendiente · ${v.signatures}ª firma dada`
      : 'Pendiente';

/** V2 "Bandeja central de aprobaciones": one row per scenario version in review or authorized. */
export function ApprovalTray() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'ROWS' | 'COMPACT'>('ROWS');
  useEffect(() => {
    // Phones start on cards: the eight-column table only fits sideways.
    if (window.matchMedia('(max-width: 700px)').matches) setView('COMPACT');
    api<Row[]>('/reports/versions?status=APPROVAL').then(
      // Pending first, then by folio so a request's scenarios stay together.
      (r) =>
        setRows(
          [...r].sort(
            (a, b) =>
              Number(a.status === 'APPROVED') - Number(b.status === 'APPROVED') ||
              a.request.folio.localeCompare(b.request.folio) ||
              a.scenarioName.localeCompare(b.scenarioName),
          ),
        ),
      (e) => setError(errorText(e)),
    );
  }, []);
  const seesMargin = !!rows?.some((v) => v.marginRate !== undefined);
  const group = (v: Row) =>
    v.request.clientName ? `${v.request.clientName} — ${v.request.groupName}` : v.request.groupName;
  const scenario = (v: Row) =>
    `${v.scenarioName}: ${v.participants} participantes + ${v.chaperones} chaperones (v${v.number})`;
  const action = (v: Row) =>
    v.marginRate !== undefined && (
      <Link className={v.canApprove ? 'button' : 'button secondary'} href={`/aprobaciones/${v.request.id}`}>
        {v.canApprove ? 'Dictaminar →' : 'Ver dictamen →'}
      </Link>
    );

  return (
    <>
      <section className="card tray-head">
        <div>
          <h1>Bandeja central de aprobaciones financieras y comerciales</h1>
          <p className="muted">
            Revisión por versión de escenario · Validación de margen objetivo · Segregación de funciones
            activa (quien preparó no autoriza)
          </p>
        </div>
        <div className="tabs" role="group" aria-label="Vista">
          {(
            [
              ['ROWS', 'Filas'],
              ['COMPACT', 'Tarjetas comprimidas'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>
              {label}
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
      {rows?.length === 0 && <p className="muted">Nada espera autorización.</p>}
      {!!rows?.length && view === 'ROWS' && (
        <div className="table-wrap card flush">
          <table className="tray">
            <thead>
              <tr>
                <th>Folio / Grupo</th>
                <th>Escenario (versión)</th>
                <th>Elaborado por</th>
                <th className="num">Precio / alumno</th>
                <th className="num">Total grupo</th>
                {seesMargin && <th className="num">Margen est.</th>}
                <th>Estado aprobación</th>
                <th className="num">Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <th scope="row">
                    <Link href={`/solicitudes/${v.request.id}`}>{v.request.folio}</Link>
                    <div className="wrap">{group(v)}</div>
                  </th>
                  <td className="wrap">
                    <Link href={`/cotizaciones/${v.id}`}>{scenario(v)}</Link>
                  </td>
                  <td className="wrap muted">
                    {v.preparedBy} ({v.request.officeName})
                  </td>
                  <td className="num">{amount(v.price, v.currency)}</td>
                  <td className="num strong">{amount(v.groupPrice, v.currency)}</td>
                  {seesMargin && <td className="num ok">{rate(v.marginRate)}</td>}
                  <td>{statusText(v)}</td>
                  <td className="num">{action(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!rows?.length && view === 'COMPACT' && (
        <div className="wcards compact">
          {rows.map((v) => (
            <article key={v.id} className="card wcard" aria-label={`${v.request.folio} ${v.scenarioName}`}>
              <div className="eyebrow">
                {v.request.folio} · {v.preparedBy} ({v.request.officeName})
              </div>
              <h3>{group(v)}</h3>
              <div className="muted">{scenario(v)}</div>
              <div className="stagebar">
                <span>
                  {amount(v.price, v.currency)} / alumno · {amount(v.groupPrice, v.currency)}
                  {v.marginRate !== undefined && <span className="ok"> · {rate(v.marginRate)}</span>}
                </span>
                <span className="badge">{statusText(v)}</span>
              </div>
              <div className="foot">
                <span />
                {action(v)}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
