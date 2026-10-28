'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { CHANNEL_LABEL, fmtDate, STATUS_LABEL } from '../lib/types';

interface Row {
  id: string;
  number: number;
  scenarioName: string;
  request: {
    id: string;
    folio: string;
    groupName: string;
    clientName: string | null;
    contactName: string | null;
    status: keyof typeof STATUS_LABEL;
    wonVersionId: string | null;
  };
  sentOn: string | null;
  channel: keyof typeof CHANNEL_LABEL | null;
  recipients: string | null;
  sentVia: 'APP' | 'MANUAL' | 'HISTORY';
}

/** One delivery: the scenarios of a request sent the same day through the same channel. */
interface Sent {
  key: string;
  first: Row;
  versions: Row[];
}

const CHANNEL_TEXT: Record<keyof typeof CHANNEL_LABEL, string> = {
  ...CHANNEL_LABEL,
  EMAIL: 'Correo electrónico',
};
const VIA_TEXT = { APP: 'enviada desde el cotizador', MANUAL: 'registro manual', HISTORY: 'histórico' };

const group = (r: Row['request']) => (r.clientName ? `${r.clientName} — ${r.groupName}` : r.groupName);
const version = (s: Sent) => `v${Math.max(...s.versions.map((v) => v.number))} (${s.versions.length} esc.)`;
const channel = (v: Row) => (v.channel ? `${CHANNEL_TEXT[v.channel]} (${VIA_TEXT[v.sentVia]})` : '—');
const outcome = (s: Sent) => {
  const r = s.first.request;
  if (r.status === 'WON')
    return s.versions.some((v) => v.id === r.wonVersionId) ? 'Aceptada · ganada' : 'Ganada con otra versión';
  if (r.status === 'LOST') return 'Perdida';
  return 'En revisión con escuela';
};

/** V2 "Control de Propuestas Enviadas y Aceptaciones": one row per delivery, newest first. */
export function SentTray() {
  const [rows, setRows] = useState<Sent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'ROWS' | 'COMPACT'>('ROWS');
  useEffect(() => {
    // Phones start on cards: the seven-column table only fits sideways.
    if (window.matchMedia('(max-width: 700px)').matches) setView('COMPACT');
    api<Row[]>('/reports/versions?status=SENT').then(
      (r) => {
        const byKey = new Map<string, Sent>();
        for (const v of r) {
          const key = `${v.request.id}|${v.sentOn}|${v.channel}`;
          const s = byKey.get(key);
          if (s) s.versions.push(v);
          else byKey.set(key, { key, first: v, versions: [v] });
        }
        setRows(
          [...byKey.values()].sort(
            (a, b) =>
              (b.first.sentOn ?? '').localeCompare(a.first.sentOn ?? '') ||
              a.first.request.folio.localeCompare(b.first.request.folio),
          ),
        );
      },
      (e) => setError(errorText(e)),
    );
  }, []);
  const scenarios = (s: Sent) =>
    [...s.versions]
      .sort((a, b) => a.scenarioName.localeCompare(b.scenarioName))
      .map((v) => `${v.scenarioName} v${v.number}`)
      .join(', ');
  const detail = (s: Sent) => (
    <Link className="button secondary" href={`/solicitudes/${s.first.request.id}`}>
      Ver detalle →
    </Link>
  );

  return (
    <>
      <section className="card tray-head">
        <div>
          <h1>Control de propuestas enviadas y aceptaciones</h1>
          <p className="muted">
            Trazabilidad de versiones enviadas, destinatarios, canales de entrega y evidencia de cierre
            comercial
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
      {rows?.length === 0 && <p className="muted">Aún no hay envíos.</p>}
      {!!rows?.length && view === 'ROWS' && (
        <div className="table-wrap card flush">
          <table className="tray">
            <thead>
              <tr>
                <th>Folio / Grupo</th>
                <th>Versión enviada</th>
                <th>Destinatario</th>
                <th>Canal</th>
                <th>Fecha de envío</th>
                <th>Seguimiento / Resultado</th>
                <th className="num">Expediente</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key}>
                  <th scope="row">
                    <Link href={`/solicitudes/${s.first.request.id}`}>{s.first.request.folio}</Link>
                    <div className="wrap">{group(s.first.request)}</div>
                  </th>
                  <td className="strong" title={scenarios(s)}>
                    {version(s)}
                  </td>
                  <td className="wrap">
                    {s.first.request.contactName && <div>{s.first.request.contactName}</div>}
                    <code className="muted" style={{ overflowWrap: 'anywhere' }}>
                      {s.first.recipients ?? '—'}
                    </code>
                  </td>
                  <td className="wrap">{channel(s.first)}</td>
                  <td>{fmtDate(s.first.sentOn)}</td>
                  <td className="wrap">{outcome(s)}</td>
                  <td className="num">{detail(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!rows?.length && view === 'COMPACT' && (
        <div className="wcards compact">
          {rows.map((s) => (
            <article key={s.key} className="card wcard" aria-label={s.first.request.folio}>
              <div className="eyebrow">
                {s.first.request.folio} · {fmtDate(s.first.sentOn)}
              </div>
              <h3>{group(s.first.request)}</h3>
              <div className="muted">
                {version(s)} · {channel(s.first)}
              </div>
              {/* Long e-mail addresses would push a phone card sideways. */}
              <div className="muted" style={{ overflowWrap: 'anywhere' }}>
                {s.first.request.contactName ? `${s.first.request.contactName} · ` : ''}
                {s.first.recipients ?? '—'}
              </div>
              <div className="stagebar">
                <span title={scenarios(s)}>{scenarios(s)}</span>
                <span className="badge">{outcome(s)}</span>
              </div>
              <div className="foot">
                <span />
                {detail(s)}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
