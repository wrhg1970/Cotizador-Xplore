'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { CHANNEL_LABEL, fmtDate, STATUS_LABEL } from '../lib/types';
import { matchesSearch, officeOptions, TrayFilters } from '../TrayFilters';

interface Row {
  id: string;
  number: number;
  scenarioName: string;
  status: string;
  request: {
    id: string;
    folio: string;
    groupName: string;
    clientName: string | null;
    contactName: string | null;
    status: keyof typeof STATUS_LABEL;
    wonVersionId: string | null;
    version: number;
    canRecordOutcome: boolean;
    officeCode: string;
    officeName: string;
    assignedToMe: boolean;
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
const OUTCOME = {
  OPEN: 'En revisión con escuela',
  WON: 'Vendida',
  WON_OTHER: 'Vendida con otra versión',
  LOST: 'Perdida',
} as const;
const outcomeKey = (s: Sent): keyof typeof OUTCOME => {
  const r = s.first.request;
  if (r.status === 'WON') return s.versions.some((v) => v.id === r.wonVersionId) ? 'WON' : 'WON_OTHER';
  return r.status === 'LOST' ? 'LOST' : 'OPEN';
};
const outcome = (s: Sent) => OUTCOME[outcomeKey(s)];

/** V2 "Control de Propuestas Enviadas y Aceptaciones": one row per delivery, newest first. */
export function SentTray() {
  const params = useSearchParams();
  const [all, setRows] = useState<Sent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'ROWS' | 'COMPACT'>('ROWS');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  const load = () =>
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
  useEffect(() => {
    // Phones start on cards: the seven-column table only fits sideways.
    if (window.matchMedia('(max-width: 700px)').matches) setView('COMPACT');
    void load();
  }, []);
  const record = async (
    s: Sent,
    body: { outcome: 'WON'; versionId: string } | { outcome: 'LOST'; reason: string },
  ) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/requests/${s.first.request.id}/outcome`, {
        method: 'POST',
        body: { ...body, version: s.first.request.version },
      });
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  // Vendida / Perdida only on the newest delivery of a request still in negotiation.
  const latest = new Set<string>();
  const seen = new Set<string>();
  for (const s of all ?? [])
    if (!seen.has(s.first.request.id)) {
      seen.add(s.first.request.id);
      latest.add(s.key);
    }
  const actions = (s: Sent) => {
    const r = s.first.request;
    if (r.status !== 'SENT' || !r.canRecordOutcome || !latest.has(s.key)) return null;
    const open = s.versions.filter((v) => v.status === 'SENT');
    const chosen = pick[s.key] ?? open[0]?.id;
    return (
      <div className="row outcome-actions" style={{ marginTop: 4, gap: 6 }}>
        {open.length > 1 && (
          <select
            aria-label="Propuesta vendida"
            value={chosen}
            onChange={(e) => setPick({ ...pick, [s.key]: e.target.value })}
          >
            {open.map((v) => (
              <option key={v.id} value={v.id}>
                {v.scenarioName} · v{v.number}
              </option>
            ))}
          </select>
        )}
        {chosen && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void record(s, { outcome: 'WON', versionId: chosen })}
          >
            Marcar vendida
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            const reason = window.prompt('¿Por qué no aceptó el cliente? (obligatorio)')?.trim();
            if (reason) void record(s, { outcome: 'LOST', reason });
          }}
        >
          Perdida
        </button>
      </div>
    );
  };
  const p = (k: string) => params.get(k) ?? '';
  const rows = all?.filter(
    (s) =>
      (!p('resultado') || outcomeKey(s) === p('resultado')) &&
      (!p('oficina') || s.first.request.officeCode === p('oficina')) &&
      (!p('canal') || s.first.channel === p('canal')) &&
      (!p('mias') || s.first.request.assignedToMe) &&
      matchesSearch(p('q'), [
        s.first.request.folio,
        s.first.request.clientName,
        s.first.request.groupName,
        s.first.request.contactName,
        s.first.recipients,
      ]),
  );
  const channels = [...new Set((all ?? []).map((s) => s.first.channel).filter((c) => c !== null))];
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
      <TrayFilters
        placeholder="Buscar folio, colegio, grupo o destinatario…"
        selects={[
          { key: 'resultado', label: 'Resultado', options: Object.entries(OUTCOME) },
          {
            key: 'oficina',
            label: 'Oficina',
            options: officeOptions((all ?? []).map((s) => s.first.request)),
          },
          { key: 'canal', label: 'Canal', options: channels.map((c) => [c, CHANNEL_TEXT[c]] as const) },
        ]}
        checks={[['mias', 'Solo asignadas a mí']]}
        shown={rows?.length ?? null}
        total={all?.length ?? null}
      />
      {all?.length === 0 && <p className="muted">Aún no hay envíos.</p>}
      {!!all?.length && rows?.length === 0 && <p className="muted">Nada coincide con estos filtros.</p>}
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
                  <td className="wrap">
                    {outcome(s)}
                    {actions(s)}
                  </td>
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
              {actions(s)}
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
