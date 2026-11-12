'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import type { RequestStatus } from '@ee/contracts';
import { api, errorText } from '../lib/api';

/** One request of the period, as GET /reports/summary lists it. */
interface Row {
  id: string;
  folio: string;
  officeId: string;
  officeCode: string;
  officeName: string;
  countryCode: string;
  createdAt: string;
  departureDate: string;
  firstSentOn: string | null;
  status: RequestStatus;
  reached: 1 | 2 | 3 | 4 | 5;
  lostReason: string | null;
  participants: number;
  chaperones: number;
  volumeMxn: string | null;
  /** Present only where the user sees internal costs. */
  commissionMxn?: string | null;
  suppliers?: { name: string; kind: string | null; costMxn: string }[];
}
interface Summary {
  period: { from: string; to: string; basis: Basis };
  truncated: boolean;
  rows: Row[];
}
interface Office {
  id: string;
  code: string;
  name: string;
}
type Basis = 'CREATED' | 'DEPARTURE';

const TABS = [
  ['general', 'General'],
  ['oficina', 'Por oficina'],
  ['pais', 'Por país'],
  ['proveedor', 'Por proveedor'],
  ['solicitud', 'Por fecha de solicitud'],
  ['salida', 'Por fecha de salida'],
] as const;
type Tab = (typeof TABS)[number][0];

// Display only: the API keeps exact decimals as strings.
const n = (x: string | null | undefined) => (x ? Number(x) : 0);
const int = new Intl.NumberFormat('es-MX');
const money = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const short = (x: number) =>
  Math.abs(x) >= 1e6
    ? `$${(x / 1e6).toFixed(1)} M`
    : Math.abs(x) >= 1e3
      ? `$${Math.round(x / 1e3)} mil`
      : money.format(x);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const regions = new Intl.DisplayNames(['es'], { type: 'region' });
const countryName = (c: string) => {
  try {
    return regions.of(c) ?? c;
  } catch {
    return c;
  }
};
const monthFmt = new Intl.DateTimeFormat('es-MX', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const monthLabel = (ym: string) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`));
/** Same day one year earlier (29 Feb → 28 Feb). */
const yearBefore = (iso: string) =>
  `${Number(iso.slice(0, 4)) - 1}${iso.slice(4) === '-02-29' ? '-02-28' : iso.slice(4)}`;
const DAY = 86_400_000;

/** Status colors of the stacked bars, validated for color blindness (dataviz skill). */
const PARTS = [
  { key: 'won', label: 'Vendidas', cls: 'rp-won' },
  { key: 'open', label: 'Abiertas', cls: 'rp-open' },
  { key: 'lost', label: 'Perdidas', cls: 'rp-lost' },
] as const;

interface Bucket {
  key: string;
  label: string;
  requests: number;
  sent: number;
  won: number;
  lost: number;
  open: number;
  students: number;
  chaperones: number;
  saleMxn: number;
  commissionMxn: number;
  /** Won trips whose price has no MXN rate: not added, never inferred. */
  withoutRate: number;
  sendDays: number[];
}
const empty = (key: string, label: string): Bucket => ({
  key,
  label,
  requests: 0,
  sent: 0,
  won: 0,
  lost: 0,
  open: 0,
  students: 0,
  chaperones: 0,
  saleMxn: 0,
  commissionMxn: 0,
  withoutRate: 0,
  sendDays: [],
});
function add(b: Bucket, r: Row) {
  b.requests++;
  if (r.reached >= 4) b.sent++;
  if (r.firstSentOn) b.sendDays.push((Date.parse(r.firstSentOn) - Date.parse(r.createdAt)) / DAY);
  if (r.status === 'WON') {
    b.won++;
    b.students += r.participants;
    b.chaperones += r.chaperones;
    if (r.volumeMxn) b.saleMxn += n(r.volumeMxn);
    else b.withoutRate++;
    b.commissionMxn += n(r.commissionMxn);
  } else if (r.status === 'LOST') b.lost++;
  else if (r.status !== 'CANCELLED') b.open++;
}
function group(rows: Row[], keyOf: (r: Row) => [string, string], keys: [string, string][] = []) {
  const m = new Map(keys.map(([k, l]) => [k, empty(k, l)]));
  for (const r of rows) {
    const [k, l] = keyOf(r);
    const b = m.get(k) ?? empty(k, l);
    m.set(k, b);
    add(b, r);
  }
  return [...m.values()];
}
const total = (rows: Row[]) => group(rows, () => ['all', 'Total'])[0] ?? empty('all', 'Total');
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** Every month of the period, so empty months show as zero. */
function monthsOf(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  for (
    let d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
    d.toISOString() <= `${to}T`;
    d.setUTCMonth(d.getUTCMonth() + 1)
  ) {
    const ym = d.toISOString().slice(0, 7);
    out.push([ym, monthLabel(ym)]);
  }
  return out.slice(0, 36);
}
const byOffice = (r: Row): [string, string] => [r.officeCode, r.officeCode];
const byCountry = (r: Row): [string, string] => [r.countryCode, countryName(r.countryCode)];

export default function ReportsPage() {
  const year = new Date().getFullYear();
  const [tab, setTab] = useState<Tab>('general');
  const [filters, setFilters] = useState({
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    basis: 'CREATED' as Basis,
    officeId: '',
  });
  const [country, setCountry] = useState('');
  const [offices, setOffices] = useState<Office[]>([]);
  const [data, setData] = useState<Summary | null>(null);
  const [before, setBefore] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Office[]>('/offices').then(setOffices, () => undefined);
  }, []);
  useEffect(() => {
    const q = (from: string, to: string) => {
      const p = new URLSearchParams({ from, to, basis: filters.basis });
      if (filters.officeId) p.set('officeId', filters.officeId);
      return api<Summary>(`/reports/summary?${p}`);
    };
    setError(null);
    Promise.all([q(filters.from, filters.to), q(yearBefore(filters.from), yearBefore(filters.to))]).then(
      ([now, prev]) => {
        setData(now);
        setBefore(prev);
      },
      (e) => setError(errorText(e)),
    );
  }, [filters]);

  const pick = (r: Row) => !country || r.countryCode === country;
  const rows = data?.rows.filter(pick) ?? [];
  const prev = before?.rows.filter(pick) ?? [];
  const internal = rows.some((r) => 'commissionMxn' in r);
  const countries = [...new Set(data?.rows.map((r) => r.countryCode))].sort();
  const months = monthsOf(filters.from, filters.to);
  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <>
      <h1 style={{ marginBottom: 2 }}>Reportes</h1>
      <p className="muted" style={{ margin: 0 }}>
        Solicitudes, propuestas y ventas del periodo. Montos en MXN al tipo de cambio guardado en cada
        cotización. También: <Link href="/tablero">reporte financiero (Excel)</Link> ·{' '}
        <Link href="/bitacora">bitácora (CSV)</Link>
      </p>
      <div role="tablist" aria-label="Reportes" className="tabs rp-tabs">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="card rp-filters">
        <label>
          Desde
          <input
            type="date"
            value={filters.from}
            max={filters.to}
            onChange={(e) => e.target.value && set('from', e.target.value)}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={filters.to}
            min={filters.from}
            onChange={(e) => e.target.value && set('to', e.target.value)}
          />
        </label>
        <div role="group" aria-label="Fecha base" className="rp-seg">
          <span className="muted">Fecha base</span>
          {(
            [
              ['CREATED', 'Solicitud'],
              ['DEPARTURE', 'Salida'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={filters.basis === k} onClick={() => set('basis', k)}>
              {l}
            </button>
          ))}
        </div>
        <label>
          Oficina
          <select value={filters.officeId} onChange={(e) => set('officeId', e.target.value)}>
            <option value="">Todas mis oficinas</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          País
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Todos</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {countryName(c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data?.truncated && (
        <p className="muted">Hay más solicitudes de las que caben en el reporte: acota el periodo.</p>
      )}
      {data && (
        <div role="tabpanel" aria-label={TABS.find(([k]) => k === tab)![1]}>
          {tab === 'general' && (
            <General rows={rows} prev={prev} months={months} basis={filters.basis} internal={internal} />
          )}
          {tab === 'oficina' && (
            <Dimension
              title="Oficina"
              groups={group(rows, byOffice)}
              internal={internal}
              names={new Map(rows.map((r) => [r.officeCode, r.officeName]))}
            />
          )}
          {tab === 'pais' && (
            <Dimension title="País destino" groups={group(rows, byCountry)} internal={internal} />
          )}
          {tab === 'proveedor' && <Suppliers rows={rows} internal={internal} />}
          {tab === 'solicitud' && (
            <ByMonth rows={rows} months={months} date="createdAt" internal={internal} />
          )}
          {tab === 'salida' && (
            <ByMonth rows={rows} months={months} date="departureDate" internal={internal} />
          )}
        </div>
      )}
    </>
  );
}

function Delta({
  now,
  before,
  unit = '',
  invert = false,
}: {
  now: number;
  before: number;
  unit?: string;
  invert?: boolean;
}) {
  if (!before) return <span className="muted">sin año anterior</span>;
  const d = now - before;
  const good = invert ? d < 0 : d > 0;
  const text =
    unit === '%' ? `${Math.round((d / before) * 100)}%` : `${int.format(Math.round(d * 10) / 10)}${unit}`;
  return (
    <span className={d === 0 ? 'muted' : good ? 'rp-up' : 'rp-down'}>
      {d >= 0 ? '▲' : '▼'} {text.replace('-', '')} vs año ant.
    </span>
  );
}

function General({
  rows,
  prev,
  months,
  basis,
  internal,
}: {
  rows: Row[];
  prev: Row[];
  months: [string, string][];
  basis: Basis;
  internal: boolean;
}) {
  const t = total(rows);
  const p = total(prev);
  const days = avg(t.sendDays);
  const daysBefore = avg(p.sendDays);
  const tiles: [string, string, ReactNode, boolean?][] = [
    ['Solicitudes', int.format(t.requests), <Delta key="r" now={t.requests} before={p.requests} unit="%" />],
    [
      'Propuestas enviadas',
      int.format(t.sent),
      <span key="s" className="muted">
        {pct(t.sent, t.requests)} de solicitudes
      </span>,
    ],
    ['Vendidas', int.format(t.won), <Delta key="w" now={t.won} before={p.won} />],
    [
      'Conversión',
      pct(t.won, t.sent),
      <span key="c" className="muted">
        de las enviadas
      </span>,
    ],
    [
      'Alumnos vendidos',
      int.format(t.students),
      <span key="a" className="muted">
        + {t.chaperones} chaperones
      </span>,
    ],
    [
      'Venta (MXN)',
      short(t.saleMxn),
      t.withoutRate ? (
        <span key="v" className="muted">
          + {t.withoutRate} sin tipo de cambio
        </span>
      ) : (
        <Delta key="v" now={t.saleMxn} before={p.saleMxn} unit="%" />
      ),
    ],
    [
      'Días a 1er envío',
      days === null ? '—' : days.toFixed(1),
      days !== null && daysBefore !== null ? (
        <Delta key="d" now={days} before={daysBefore} invert />
      ) : (
        <span key="d" className="muted">
          solicitud → envío
        </span>
      ),
    ],
  ];
  if (internal)
    tiles.push([
      'Comisión',
      short(t.commissionMxn),
      <span key="m" className="muted">
        {pct(t.commissionMxn, t.saleMxn)} de venta
      </span>,
      true,
    ]);
  const funnel = [
    ['Solicitadas', 1],
    ['En cotización', 2],
    ['Aprobadas', 3],
    ['Enviadas', 4],
    ['Vendidas', 5],
  ] as const;
  const reasons = group(
    rows.filter((r) => r.status === 'LOST'),
    (r) => {
      const why = r.lostReason?.trim() || 'Sin motivo';
      return [why.toLowerCase(), why];
    },
  ).sort((a, b) => b.requests - a.requests);
  const top = <T extends Bucket>(bs: T[], by: (b: T) => number) =>
    [...bs].sort((a, b) => by(b) - by(a)).slice(0, 6);
  return (
    <>
      <section className="rp-kpis" aria-label="Indicadores">
        {tiles.map(([label, value, hint, inside]) => (
          <div key={label} className={inside ? 'card rp-kpi internal' : 'card rp-kpi'}>
            <div className="muted">
              {label}
              {inside && <span className="rp-tag"> · interno</span>}
            </div>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </section>
      <div className="rp-two">
        <section className="card">
          <Head
            title="Solicitudes y vendidas por mes"
            note={basis === 'CREATED' ? 'fecha de solicitud' : 'fecha de salida'}
          />
          <Columns
            groups={group(
              rows,
              (r) => {
                const ym = (basis === 'CREATED' ? r.createdAt : r.departureDate).slice(0, 7);
                return [ym, monthLabel(ym)];
              },
              months,
            )}
          />
        </section>
        <section className="card">
          <Head title="Embudo del periodo" note="solicitudes que llegaron a cada etapa" />
          <Bars
            items={funnel.map(([label, k]) => {
              const v = rows.filter((r) => r.reached >= k).length;
              return { label, parts: [v], value: `${v} · ${pct(v, rows.length)}` };
            })}
          />
          {reasons.length > 0 && (
            <p className="muted rp-note">
              Perdidas: {t.lost} ({reasons.map((r) => `${r.label} ${r.requests}`).join(' · ')})
            </p>
          )}
        </section>
        <section className="card">
          <Head title="Principales oficinas" note="solicitudes por estado" />
          <Stacked groups={top(group(rows, byOffice), (b) => b.requests)} />
        </section>
        <section className="card">
          <Head title="Principales países destino" note="alumnos vendidos" />
          <Bars
            items={top(group(rows, byCountry), (b) => b.students).map((b) => ({
              label: b.label,
              parts: [b.students],
              value: int.format(b.students),
            }))}
          />
        </section>
      </div>
    </>
  );
}

function Head({ title, note }: { title: string; note?: string }) {
  return (
    <h2 className="rp-head">
      {title} {note && <small className="muted">{note}</small>}
    </h2>
  );
}

/** Horizontal bars, one series or stacked parts; the value is always printed beside the bar. */
function Bars({
  items,
  classes = ['rp-one'],
}: {
  items: { label: string; parts: number[]; value: string; title?: string }[];
  classes?: string[];
}) {
  const max = Math.max(1, ...items.map((i) => i.parts.reduce((a, b) => a + b, 0)));
  if (!items.length) return <p className="muted">Sin datos en el periodo.</p>;
  return (
    <div className="rp-bars">
      {items.map((i) => (
        <div key={i.label} className="rp-bar" title={i.title ?? `${i.label}: ${i.value}`}>
          <span className="rp-label">{i.label}</span>
          <span className="rp-track">
            {i.parts.map(
              (v, k) =>
                v > 0 && <span key={k} className={classes[k]} style={{ width: `${(v / max) * 100}%` }} />,
            )}
          </span>
          <span className="num">{i.value}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; cls: string }[] }) {
  return (
    <div className="dx-legend rp-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={i.cls} /> {i.label}
        </span>
      ))}
    </div>
  );
}

function Stacked({ groups }: { groups: Bucket[] }) {
  return (
    <>
      <Legend items={[...PARTS]} />
      <Bars
        classes={PARTS.map((p) => p.cls)}
        items={groups.map((b) => ({
          label: b.label,
          parts: PARTS.map((p) => b[p.key]),
          value: int.format(b.requests),
          title: `${b.label}: ${b.won} vendidas · ${b.open} abiertas · ${b.lost} perdidas`,
        }))}
      />
    </>
  );
}

/** Requests and won per month, side by side; one axis (both are counts). */
function Columns({ groups }: { groups: Bucket[] }) {
  const W = 560;
  const H = 170;
  const pad = { l: 28, b: 22, t: 8 };
  const max = Math.max(1, ...groups.map((g) => g.requests));
  const bw = (W - pad.l) / Math.max(1, groups.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const every = Math.ceil(groups.length / 12);
  return (
    <figure style={{ margin: 0 }}>
      <Legend
        items={[
          { label: 'Solicitudes', cls: 'rp-open' },
          { label: 'Vendidas', cls: 'rp-won' },
        ]}
      />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="dx-svg"
        role="img"
        aria-label="Solicitudes y vendidas por mes"
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {groups.map((g, i) => {
          const x = pad.l + i * bw + bw * 0.15;
          const w = (bw * 0.7) / 2;
          return (
            <g key={g.key}>
              <title>{`${g.label}: ${g.requests} solicitudes · ${g.won} vendidas`}</title>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              <rect
                className="rp-open"
                x={x}
                y={y(g.requests)}
                width={w - 1}
                height={H - pad.b - y(g.requests)}
                rx={2}
              />
              <rect
                className="rp-won"
                x={x + w + 1}
                y={y(g.won)}
                width={w - 1}
                height={H - pad.b - y(g.won)}
                rx={2}
              />
              {i % every === 0 && (
                <text x={pad.l + i * bw + bw / 2} y={H - 6} textAnchor="middle">
                  {g.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Table shared by every grouping; commission only for roles that see internal costs. */
function Table({
  title,
  groups,
  internal,
  names,
}: {
  title: string;
  groups: Bucket[];
  internal: boolean;
  names?: Map<string, string>;
}) {
  const t = groups.reduce(
    (acc, g) => {
      for (const k of [
        'requests',
        'sent',
        'won',
        'lost',
        'open',
        'students',
        'chaperones',
        'saleMxn',
        'commissionMxn',
        'withoutRate',
      ] as const)
        acc[k] += g[k];
      acc.sendDays.push(...g.sendDays);
      return acc;
    },
    empty('total', 'Total'),
  );
  const line = (g: Bucket, strong = false) => (
    <tr key={g.key} style={strong ? { fontWeight: 700 } : undefined}>
      <th scope="row">
        {names ? (
          <>
            <span className="ofc-code">{g.label}</span> {names.get(g.key)}
          </>
        ) : (
          g.label
        )}
      </th>
      <td className={g.requests ? 'num' : 'num zero'}>{g.requests}</td>
      <td className={g.sent ? 'num' : 'num zero'}>{g.sent}</td>
      <td className={g.won ? 'num' : 'num zero'}>{g.won}</td>
      <td className="num">{pct(g.won, g.sent)}</td>
      <td className="num">{int.format(g.students)}</td>
      <td className="num">
        {money.format(g.saleMxn)}
        {g.withoutRate > 0 && <div className="muted">+ {g.withoutRate} sin TC</div>}
      </td>
      <td className="num">
        {g.students && g.won > g.withoutRate ? money.format(g.saleMxn / g.students) : '—'}
      </td>
      {internal && <td className="num">{money.format(g.commissionMxn)}</td>}
    </tr>
  );
  return (
    <div className="table-wrap">
      <table className="office-table">
        <thead>
          <tr>
            <th>{title}</th>
            <th className="num">Solicitudes</th>
            <th className="num">Enviadas</th>
            <th className="num">Vendidas</th>
            <th className="num">Conversión</th>
            <th className="num">Alumnos vendidos</th>
            <th className="num">Venta MXN</th>
            <th className="num">Prom./alumno</th>
            {internal && <th className="num">Comisión</th>}
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 && (
            <tr>
              <td colSpan={9} className="muted">
                Sin solicitudes en el periodo.
              </td>
            </tr>
          )}
          {groups.map((g) => line(g))}
          {groups.length > 1 && line(t, true)}
        </tbody>
      </table>
    </div>
  );
}

function Dimension({
  title,
  groups,
  internal,
  names,
}: {
  title: string;
  groups: Bucket[];
  internal: boolean;
  names?: Map<string, string>;
}) {
  const sorted = [...groups].sort((a, b) => b.requests - a.requests || a.label.localeCompare(b.label));
  return (
    <>
      <div className="rp-two">
        <section className="card">
          <Head title={`Solicitudes por ${title.toLowerCase()}`} note="por estado" />
          <Stacked groups={sorted} />
        </section>
        <section className="card">
          <Head title={`Venta por ${title.toLowerCase()} (MXN)`} note="propuestas vendidas" />
          <Bars
            items={[...sorted]
              .sort((a, b) => b.saleMxn - a.saleMxn)
              .map((b) => ({ label: b.label, parts: [b.saleMxn], value: short(b.saleMxn) }))}
          />
        </section>
      </div>
      <section className="card rp-table">
        <Table title={title} groups={sorted} internal={internal} names={names} />
      </section>
    </>
  );
}

function ByMonth({
  rows,
  months,
  date,
  internal,
}: {
  rows: Row[];
  months: [string, string][];
  date: 'createdAt' | 'departureDate';
  internal: boolean;
}) {
  const groups = group(rows, (r) => [r[date].slice(0, 7), monthLabel(r[date].slice(0, 7))], months).sort(
    (a, b) => a.key.localeCompare(b.key),
  );
  return (
    <>
      <section className="card">
        <Head
          title={date === 'createdAt' ? 'Por mes de solicitud' : 'Por mes de salida'}
          note="solicitudes y vendidas"
        />
        <Columns groups={groups} />
      </section>
      <section className="card rp-table">
        <Table title="Mes" groups={groups} internal={internal} />
      </section>
    </>
  );
}

/** Cost bought from each supplier in the sold (or sent) version; only roles that see costs. */
function Suppliers({ rows, internal }: { rows: Row[]; internal: boolean }) {
  const [only, setOnly] = useState<'WON' | 'SENT'>('WON');
  if (!internal)
    return (
      <p className="card muted">
        Este reporte muestra costos: solo lo ven los roles con permiso de ver costos.
      </p>
    );
  const picked = rows.filter((r) => (only === 'WON' ? r.status === 'WON' : r.reached >= 4));
  const sup = new Map<
    string,
    { name: string; kind: string; trips: number; students: number; cost: number }
  >();
  const kinds = new Map<string, number>();
  for (const r of picked)
    for (const s of r.suppliers ?? []) {
      const kind = s.kind?.trim() || 'Sin tipo';
      const e = sup.get(s.name) ?? { name: s.name, kind, trips: 0, students: 0, cost: 0 };
      e.trips++;
      e.students += r.participants;
      e.cost += n(s.costMxn);
      sup.set(s.name, e);
      kinds.set(kind, (kinds.get(kind) ?? 0) + n(s.costMxn));
    }
  const list = [...sup.values()].sort((a, b) => b.cost - a.cost);
  const all = list.reduce((a, s) => a + s.cost, 0);
  return (
    <>
      <div role="group" aria-label="Propuestas" className="rp-seg" style={{ marginBottom: 10 }}>
        <span className="muted">Solo</span>
        <button type="button" aria-pressed={only === 'WON'} onClick={() => setOnly('WON')}>
          Vendidas
        </button>
        <button type="button" aria-pressed={only === 'SENT'} onClick={() => setOnly('SENT')}>
          Enviadas
        </button>
      </div>
      <div className="rp-two wide">
        <section className="card">
          <Head
            title="Costo por proveedor (MXN)"
            note={only === 'WON' ? 'propuesta vendida de cada viaje' : 'propuesta más avanzada'}
          />
          <Bars
            items={list.slice(0, 12).map((s) => ({ label: s.name, parts: [s.cost], value: short(s.cost) }))}
          />
          <p className="muted rp-note">
            Proveedor = el de la tarifa elegida en el concepto (Proveedores y tarifas). Conceptos capturados a
            mano van en &quot;Sin proveedor&quot;. Cotizaciones sin tipo de cambio a MXN no se suman.
          </p>
        </section>
        <section className="card">
          <Head title="Por tipo de proveedor" />
          <Bars
            items={[...kinds]
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => ({ label: k, parts: [v], value: short(v) }))}
          />
        </section>
      </div>
      <section className="card rp-table">
        <div className="table-wrap">
          <table className="office-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Tipo</th>
                <th className="num">Viajes</th>
                <th className="num">Alumnos</th>
                <th className="num">Costo MXN</th>
                <th>Participación</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Sin propuestas en el periodo.
                  </td>
                </tr>
              )}
              {list.map((s) => (
                <tr key={s.name}>
                  <th scope="row">{s.name}</th>
                  <td>{s.kind}</td>
                  <td className="num">{s.trips}</td>
                  <td className="num">{int.format(s.students)}</td>
                  <td className="num">{money.format(s.cost)}</td>
                  <td>
                    <span className="rp-mini" style={{ width: `${all ? (s.cost / all) * 120 : 0}px` }} />{' '}
                    {pct(s.cost, all)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
