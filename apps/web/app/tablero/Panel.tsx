'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { RequestStatus } from '@ee/contracts';
import { fmtDate } from '../lib/types';

/** One request of the period's cohort, as GET /dashboard/executive lists it. */
export interface CohortRow {
  id: string;
  folio: string;
  groupName: string;
  clientName: string | null;
  program: string | null;
  officeCode: string;
  city: string;
  countryCode: string;
  participants: number;
  chaperones: number;
  staff: number;
  scenarios: number;
  createdAt: string;
  departureDate: string;
  dueDate: string | null;
  firstSentOn: string | null;
  status: RequestStatus;
  /** "Mi trabajo" stage: 1 Solicitada, 2 Cotizada (in review), 3 Aprobada, 4 Enviada. */
  stage: 1 | 2 | 3 | 4;
  /** Furthest funnel step: 1 Nueva, 2 En cotización, 3 Aprobada, 4 Enviada, 5 Aceptada. */
  reached: 1 | 2 | 3 | 4 | 5;
  budgetMxn: string | null;
  volumeMxn: string | null;
  /** Present only for roles that see internal costs in that office. */
  commissionMxn?: string | null;
}

const FUNNEL = [
  { name: 'Nueva solicitud', about: 'Recibidas y registradas en el periodo' },
  { name: 'En cotización', about: 'Con escenarios y hoja EE en trabajo' },
  { name: 'Aprobada', about: 'Autorizada por quien aprueba' },
  { name: 'Propuesta enviada', about: 'Presentada al colegio' },
  { name: 'Aceptada', about: 'Grupo confirmado (ganada)' },
] as const;

const OPEN: RequestStatus[] = ['SUBMITTED', 'QUOTING', 'SENT'];
const isOpen = (r: CohortRow) => OPEN.includes(r.status);
const active = (r: CohortRow) => r.status !== 'LOST' && r.status !== 'CANCELLED';
const pendingApproval = (r: CohortRow) => r.status === 'QUOTING' && r.stage === 2;
const quoting = (r: CohortRow) => r.status === 'QUOTING' && r.stage !== 2;

/** Operational state, in the order the bars show it. */
const STATES = [
  { key: 'NEW', label: 'Nueva / por asignar', test: (r: CohortRow) => r.status === 'SUBMITTED' },
  { key: 'QUOTING', label: 'En cotización', test: quoting },
  { key: 'APPROVAL', label: 'Pendiente de aprobación', test: pendingApproval },
  { key: 'SENT', label: 'Enviada / en negociación', test: (r: CohortRow) => r.status === 'SENT' },
  { key: 'WON', label: 'Ganada', test: (r: CohortRow) => r.status === 'WON' },
  { key: 'LOST', label: 'Perdida', test: (r: CohortRow) => r.status === 'LOST' },
] as const;

const FILTERS = [
  { key: 'ALL', label: 'Todas', test: (_: CohortRow) => true },
  { key: 'QUOTING', label: 'En cotización', test: (r: CohortRow) => r.status === 'SUBMITTED' || quoting(r) },
  { key: 'APPROVAL', label: 'Por aprobar', test: pendingApproval },
  { key: 'SENT', label: 'Enviadas / negociación', test: (r: CohortRow) => r.status === 'SENT' },
  { key: 'WON', label: 'Aceptadas', test: (r: CohortRow) => r.status === 'WON' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'] | `STEP${1 | 2 | 3 | 4 | 5}`;

const STAGE_LABEL = (r: CohortRow) =>
  r.status === 'WON'
    ? '05 · Aceptada'
    : r.status === 'LOST'
      ? 'Perdida'
      : r.status === 'CANCELLED'
        ? 'Cancelada'
        : `0${r.reached} · ${FUNNEL[r.reached - 1]!.name}${pendingApproval(r) ? ' (por aprobar)' : ''}`;

// Display only: the API keeps exact decimals as strings.
const money = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const compact = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });
const num = (x: string | null | undefined) => (x ? Number(x) : 0);
const pctOf = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const sum = (rows: CohortRow[], f: (r: CohortRow) => number) => rows.reduce((s, r) => s + f(r), 0);
const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

/** Monday (UTC) of the week an ISO day falls in. */
const weekOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};
const weekFmt = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', timeZone: 'UTC' });

export function Panel({ rows, to }: { rows: CohortRow[]; to: string }) {
  const [mode, setMode] = useState<'CUM' | 'NOW'>('CUM');
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'ROWS' | 'CARDS'>('ROWS');
  const showCommission = rows.some((r) => 'commissionMxn' in r);

  const live = rows.filter(active);
  const open = rows.filter(isOpen);
  const won = rows.filter((r) => r.status === 'WON').length;
  const lost = rows.filter((r) => r.status === 'LOST').length;
  const sent = rows.filter((r) => r.reached >= 4).length;
  const students = sum(live, (r) => r.participants);
  const chaperones = sum(live, (r) => r.chaperones);
  const staff = sum(live, (r) => r.staff);
  const priced = live.filter((r) => r.volumeMxn);
  const volume = sum(priced, (r) => num(r.volumeMxn));
  const pricedStudents = sum(priced, (r) => r.participants);
  const byProgram = new Map<string, number>();
  for (const r of live) {
    const name = r.program?.trim() || 'Sin tipo de programa';
    byProgram.set(name, (byProgram.get(name) ?? 0) + r.participants);
  }
  const programs = [...byProgram]
    .map(([name, students]) => ({ name, students }))
    .sort((a, b) => b.students - a.students)
    .slice(0, 4);

  const step = (k: number) =>
    rows.filter((r) => (mode === 'CUM' ? r.reached >= k : r.reached === k && active(r)));
  const steps = FUNNEL.map((_, i) => step(i + 1));
  const base = steps[0]!.length;

  const soon = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);
  const late = open.filter((r) => r.dueDate && r.dueDate <= soon).length;
  const sentTimes = rows.filter((r) => r.firstSentOn).map((r) => days(r.createdAt, r.firstSentOn!));
  const kpis: [string, string | number, string, string?][] = [
    ['Solicitudes recibidas', rows.length, 'Registradas en el periodo'],
    ['Solicitudes nuevas', rows.filter((r) => r.status === 'SUBMITTED').length, 'Por asignar'],
    ['En cotización', rows.filter(quoting).length, 'Análisis y escenarios'],
    ['Pendientes de aprobación', rows.filter(pendingApproval).length, 'Esperan autorización', 'warn'],
    ['Propuestas enviadas', sent, 'Llegaron a enviarse'],
    ['Propuestas aceptadas', won, 'Cierre comercial', 'ok'],
    ['Propuestas rechazadas', lost, 'Con motivo registrado'],
    ['Vencidas o por vencer', late, 'Entrega en 5 días o menos', late ? 'bad' : undefined],
    [
      'Tiempo promedio al envío',
      sentTimes.length ? `${(sentTimes.reduce((a, b) => a + b, 0) / sentTimes.length).toFixed(1)} días` : '—',
      'Solicitud → primer envío',
    ],
    ['Tasa de aceptación', pctOf(won, sent), 'Sobre propuestas enviadas'],
  ];

  const needle = query.trim().toLowerCase();
  const passes = (r: CohortRow) =>
    filter.startsWith('STEP')
      ? steps[Number(filter.slice(4)) - 1]!.includes(r)
      : FILTERS.find((f) => f.key === filter)!.test(r);
  const shown = rows.filter(
    (r) =>
      passes(r) &&
      (!needle ||
        [r.folio, r.groupName, r.clientName, r.city, r.countryCode, r.officeCode].some((x) =>
          x?.toLowerCase().includes(needle),
        )),
  );

  return (
    <>
      <section className="dx-hero" aria-label="Resumen">
        <div className="card">
          <div className="eyebrow">Solicitudes activas en ciclo</div>
          <div className="dx-big">
            {open.length} <small>de {rows.length} registradas</small>
          </div>
          <div className="muted">
            {rows.filter(quoting).length + rows.filter((r) => r.status === 'SUBMITTED').length} en cotización
            · {rows.filter(pendingApproval).length} por aprobar ·{' '}
            {rows.filter((r) => r.status === 'SENT').length} enviadas
          </div>
          <Stack
            parts={[
              { label: 'Aceptadas', value: won, cls: 's-won' },
              { label: 'Enviadas', value: rows.filter((r) => r.status === 'SENT').length, cls: 's-sent' },
              { label: 'Por aprobar', value: rows.filter(pendingApproval).length, cls: 's-approve' },
            ]}
            note={`Tasa de cierre: ${pctOf(won, won + lost)}`}
          />
        </div>
        <div className="card">
          <div className="eyebrow">Participantes proyectados</div>
          <div className="dx-big">
            {students} <small>estudiantes</small>
          </div>
          <div className="muted">
            +{chaperones} chaperones · +{staff} staff ({students + chaperones + staff} viajeros)
          </div>
          <dl className="dx-mini">
            <div>
              <dt>Prom. grupo</dt>
              <dd>{live.length ? Math.round(students / live.length) : 0} alum.</dd>
            </div>
            <div>
              <dt>Ratio chaperones</dt>
              <dd>{chaperones ? `1 : ${Math.round(students / chaperones)}` : '—'}</dd>
            </div>
            <div>
              <dt>Escenarios</dt>
              <dd>{sum(live, (r) => r.scenarios)}</dd>
            </div>
          </dl>
        </div>
        <div className="card">
          <div className="eyebrow">Volumen cotizado (MXN)</div>
          <div className="dx-big dx-money">{money.format(volume)}</div>
          <div className="muted">
            Promedio por estudiante: {pricedStudents ? money.format(volume / pricedStudents) : '—'}
            {live.length > priced.length && ` · ${live.length - priced.length} sin precio en MXN`}
          </div>
          <div className="dx-sub">Alumnos por tipo de programa</div>
          {programs.map((p) => (
            <div key={p.name} className="dx-prog">
              <span>{p.name}</span>
              <span className="num">
                {p.students} alum. · {pctOf(p.students, students)}
              </span>
              <span className="track">
                <span className="fill" style={{ width: pctOf(p.students, students) }} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card dx-funnel" aria-labelledby="embudo">
        <div className="dx-sechead">
          <div>
            <div className="eyebrow">Embudo de conversión comercial</div>
            <h2 id="embudo">De nueva solicitud a propuesta aceptada</h2>
            <p className="muted">Toca una etapa para ver sus expedientes en la tabla de abajo.</p>
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            <dl className="dx-mini boxed">
              <div>
                <dt>Conversión global</dt>
                <dd>{pctOf(rows.filter((r) => r.reached === 5).length, base)}</dd>
              </div>
              <div>
                <dt>Cierre s/ enviadas</dt>
                <dd>{pctOf(won, sent)}</dd>
              </div>
            </dl>
            <div className="tabs" role="group" aria-label="Modo del embudo" style={{ margin: 0 }}>
              <button type="button" aria-pressed={mode === 'CUM'} onClick={() => setMode('CUM')}>
                Conversión acumulada
              </button>
              <button type="button" aria-pressed={mode === 'NOW'} onClick={() => setMode('NOW')}>
                En etapa actual
              </button>
            </div>
          </div>
        </div>
        <div className="dx-funnel-body">
          <FunnelChart counts={steps.map((s) => s.length)} />
          <ol className="dx-steps">
            {FUNNEL.map((f, i) => {
              const rs = steps[i]!;
              const prev = steps[i - 1];
              return (
                <li key={f.name}>
                  {i > 0 && mode === 'CUM' && (
                    <div className="dx-hop muted">
                      ↘ Avance etapa 0{i} → 0{i + 1}: {pctOf(rs.length, prev!.length)}
                    </div>
                  )}
                  <button
                    type="button"
                    className={`dx-step${filter === `STEP${i + 1}` ? ' on' : ''}`}
                    aria-pressed={filter === `STEP${i + 1}`}
                    onClick={() =>
                      setFilter(filter === `STEP${i + 1}` ? 'ALL' : (`STEP${i + 1}` as FilterKey))
                    }
                  >
                    <span className={`dx-num n${i + 1}`}>0{i + 1}</span>
                    <span className="dx-step-name">
                      <strong>{f.name}</strong> · {pctOf(rs.length, base)} del total
                      <span className="muted">{f.about}</span>
                    </span>
                    <span className="dx-step-fig">
                      <small>Solicitudes</small>
                      <strong>
                        {rs.length} <span className="muted">({sum(rs, (r) => r.participants)} al.)</span>
                      </strong>
                    </span>
                    <span className="dx-step-fig">
                      <small>Volumen MXN</small>
                      <strong className="dx-money">{money.format(sum(rs, (r) => num(r.volumeMxn)))}</strong>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <div className="dx-two">
        <section className="card" aria-labelledby="por-estado">
          <h2 id="por-estado">Solicitudes por estado operativo</h2>
          <p className="muted">Expedientes del periodo y sus alumnos por etapa del ciclo comercial.</p>
          {STATES.map((s) => {
            const rs = rows.filter(s.test);
            const max = Math.max(1, ...STATES.map((x) => rows.filter(x.test).length));
            return (
              <div key={s.key} className="hbar" title={`${s.label}: ${rs.length}`}>
                <span>{s.label}</span>
                <span className="track">
                  <span className={`fill st-${s.key}`} style={{ width: `${(rs.length / max) * 100}%` }} />
                </span>
                <strong className="num">
                  {rs.length} <span className="muted">({sum(rs, (r) => r.participants)} al.)</span>
                </strong>
              </div>
            );
          })}
        </section>
        <section className="card" aria-labelledby="volumen">
          <h2 id="volumen">Volumen{showCommission ? ' y comisión' : ''} por solicitud (MXN)</h2>
          <p className="muted">
            Presupuesto del colegio contra volumen cotizado
            {showCommission ? ' y comisión proyectada (solo la ve quien ve costos)' : ''}. Las 8 de mayor
            volumen.
          </p>
          <VolumeChart rows={rows} showCommission={showCommission} />
        </section>
      </div>

      <Trend rows={rows} to={to} />

      <section className="card dx-filter" aria-label="Filtro de expedientes">
        <div className="tabs" role="group" aria-label="Etapa" style={{ margin: 0 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label} ({rows.filter(f.test).length})
            </button>
          ))}
          {filter.startsWith('STEP') && (
            <button type="button" aria-pressed onClick={() => setFilter('ALL')}>
              Etapa {FUNNEL[Number(filter.slice(4)) - 1]!.name} ✕
            </button>
          )}
        </div>
        <input
          type="search"
          aria-label="Buscar expediente"
          placeholder="Buscar folio, colegio o destino…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </section>

      <section className="dx-kpis" aria-label="Indicadores">
        {kpis.map(([label, value, hint, tone]) => (
          <div key={label} className="card">
            <div className="muted">{label}</div>
            <div className={`dx-kpi ${tone ?? ''}`}>{value}</div>
            <div className="muted">{hint}</div>
          </div>
        ))}
      </section>

      <section className="card dx-table" aria-labelledby="expedientes">
        <div className="dx-sechead">
          <div>
            <h2 id="expedientes">Expedientes recientes ({shown.length})</h2>
            <p className="muted">Abre la ficha para cotizar, comparar escenarios o autorizar.</p>
          </div>
          <div className="tabs" role="group" aria-label="Vista" style={{ margin: 0 }}>
            <button type="button" aria-pressed={view === 'ROWS'} onClick={() => setView('ROWS')}>
              Filas
            </button>
            <button type="button" aria-pressed={view === 'CARDS'} onClick={() => setView('CARDS')}>
              Tarjetas
            </button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="muted">
            {rows.length ? 'Nada coincide con el filtro.' : 'No hay solicitudes en el periodo.'}
          </p>
        ) : view === 'ROWS' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Grupo / institución</th>
                  <th>Oficina</th>
                  <th>Destino</th>
                  <th className="num">Participantes</th>
                  <th className="num">Escenarios</th>
                  <th>Entrega límite</th>
                  <th>Etapa</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/solicitudes/${r.id}`}>{r.folio}</Link>
                    </td>
                    <td style={{ whiteSpace: 'normal', minWidth: 220 }}>
                      <strong>{r.clientName ?? r.groupName}</strong>
                      <div className="muted">
                        {r.clientName ? `${r.groupName} · ` : ''}
                        {r.program ?? 'Sin programa'}
                      </div>
                    </td>
                    <td>{r.officeCode}</td>
                    <td>
                      {r.city}, {r.countryCode}
                    </td>
                    <td className="num">
                      {r.participants} + {r.chaperones} chap.
                    </td>
                    <td className="num">{r.scenarios}</td>
                    <td>{fmtDate(r.dueDate)}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 140 }}>{STAGE_LABEL(r)}</td>
                    <td>
                      <Link className="button secondary dx-act" href={`/solicitudes/${r.id}`}>
                        Ficha →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="wcards compact">
            {shown.map((r) => (
              <Link key={r.id} href={`/solicitudes/${r.id}`} className="card dx-card">
                <div className="eyebrow">
                  {r.folio} · {r.officeCode}
                </div>
                <strong>{r.clientName ?? r.groupName}</strong>
                <div className="muted">
                  {r.city}, {r.countryCode} · {r.participants} + {r.chaperones} chap. · {r.scenarios} esc.
                </div>
                <div className="muted">Entrega: {fmtDate(r.dueDate)}</div>
                <span className="badge">{STAGE_LABEL(r)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** Proportions as one stacked bar; every part also printed as text beside it. */
function Stack({ parts, note }: { parts: { label: string; value: number; cls: string }[]; note: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="dx-stack">
      <div className="dx-stack-head">
        <span>Avance del embudo</span>
        <span>{note}</span>
      </div>
      <div className="dx-stack-bar">
        {parts
          .filter((p) => p.value)
          .map((p) => (
            <span
              key={p.label}
              className={p.cls}
              style={{ flexGrow: p.value }}
              title={`${p.label}: ${p.value}`}
            />
          ))}
        {!total && <span className="empty" />}
      </div>
      <div className="dx-legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i className={p.cls} /> {p.label} ({p.value})
          </span>
        ))}
      </div>
    </div>
  );
}

/** Centered funnel: each band's width is its share of the first step. */
function FunnelChart({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  const W = 300;
  const H = 44;
  const w = (c: number) => Math.max(18, (c / max) * W);
  return (
    <figure className="dx-funnel-chart">
      <svg viewBox={`0 0 ${W} ${counts.length * H}`} role="img" aria-label="Gráfico de embudo">
        {counts.map((c, i) => {
          const top = w(c);
          const bottom = w(counts[i + 1] ?? c);
          const y = i * H;
          return (
            <polygon
              key={i}
              className={`n${i + 1}`}
              points={`${(W - top) / 2},${y + 1} ${(W + top) / 2},${y + 1} ${(W + bottom) / 2},${y + H - 1} ${(W - bottom) / 2},${y + H - 1}`}
            >
              <title>{`${FUNNEL[i]!.name}: ${c}`}</title>
            </polygon>
          );
        })}
      </svg>
      <figcaption>
        {counts.map((c, i) => (
          <div key={i} className={`dx-fbar n${i + 1}`} style={{ width: `${Math.max(64, (c / max) * 100)}%` }}>
            <span>
              0{i + 1}. {FUNNEL[i]!.name}
            </span>
            <strong>
              {c} ({pctOf(c, counts[0]!)})
            </strong>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}

/** Grouped vertical bars per request; native SVG titles are the hover tooltip. */
function VolumeChart({ rows, showCommission }: { rows: CohortRow[]; showCommission: boolean }) {
  const top = rows
    .filter((r) => r.volumeMxn || r.budgetMxn)
    .sort((a, b) => num(b.volumeMxn) - num(a.volumeMxn))
    .slice(0, 8);
  if (!top.length) return <p className="muted">Aún no hay solicitudes con precio o presupuesto en MXN.</p>;
  const series: { key: 'budgetMxn' | 'volumeMxn' | 'commissionMxn'; label: string; cls: string }[] = [
    { key: 'budgetMxn', label: 'Presupuesto del colegio', cls: 'v-budget' },
    { key: 'volumeMxn', label: 'Volumen cotizado', cls: 'v-volume' },
    ...(showCommission
      ? [{ key: 'commissionMxn' as const, label: 'Comisión proyectada', cls: 'v-commission' }]
      : []),
  ];
  const max = Math.max(1, ...top.flatMap((r) => series.map((s) => num(r[s.key]))));
  const W = 560;
  const H = 220;
  const pad = { l: 48, b: 28, t: 8 };
  const slot = (W - pad.l) / top.length;
  const bw = Math.min(26, (slot - 12) / series.length - 2);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const totalVolume = sum(top, (r) => num(r.volumeMxn));
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="dx-svg" role="img" aria-label="Volumen por solicitud">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end">
              {compact.format(max * f)}
            </text>
          </g>
        ))}
        {top.map((r, i) => {
          const x0 = pad.l + i * slot + (slot - series.length * (bw + 2)) / 2;
          return (
            <g key={r.id}>
              {series.map((s, j) => {
                const v = num(r[s.key]);
                return (
                  <rect
                    key={s.key}
                    className={s.cls}
                    x={x0 + j * (bw + 2)}
                    y={y(v)}
                    width={bw}
                    height={Math.max(0, y(0) - y(v))}
                    rx={3}
                  >
                    <title>{`${r.folio} · ${s.label}: ${r[s.key] ? money.format(v) : 'sin dato'}`}</title>
                  </rect>
                );
              })}
              <text x={pad.l + i * slot + slot / 2} y={H - 8} textAnchor="middle">
                {r.folio.slice(-6)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="dx-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i className={s.cls} /> {s.label}
          </span>
        ))}
      </figcaption>
      <p className="dx-foot">
        Volumen: <strong>{money.format(totalVolume)}</strong>
        {showCommission && (
          <>
            {' '}
            · Comisión:{' '}
            <strong className="dx-money">{money.format(sum(top, (r) => num(r.commissionMxn)))}</strong>
          </>
        )}
      </p>
    </figure>
  );
}

/** Weekly new requests and students: two small charts on one time axis (never two y-scales on one chart). */
function Trend({ rows, to }: { rows: CohortRow[]; to: string }) {
  const last = weekOf(to);
  const weeks = Array.from({ length: 8 }, (_, i) =>
    new Date(Date.parse(`${last}T00:00:00Z`) - (7 - i) * 7 * DAY).toISOString().slice(0, 10),
  );
  const byWeek = weeks.map((w) => rows.filter((r) => weekOf(r.createdAt) === w));
  const reqs = byWeek.map((rs) => rs.length);
  const studs = byWeek.map((rs) => sum(rs, (r) => r.participants));
  const peak = studs.indexOf(Math.max(...studs));
  return (
    <section className="card" aria-labelledby="tendencia" style={{ marginBottom: 16 }}>
      <div className="dx-sechead">
        <div>
          <h2 id="tendencia">Tendencia semanal de nuevas solicitudes</h2>
          <p className="muted">Solicitudes creadas y alumnos que traen, por semana (últimas 8).</p>
        </div>
        {studs[peak]! > 0 && (
          <p className="muted">
            Semana pico: <strong>{weekFmt.format(new Date(`${weeks[peak]}T00:00:00Z`))}</strong> ({reqs[peak]}{' '}
            sol. · {studs[peak]} alum.)
          </p>
        )}
      </div>
      <div className="dx-two">
        <Line title="Solicitudes" values={reqs} weeks={weeks} cls="l-req" />
        <Line title="Alumnos" values={studs} weeks={weeks} cls="l-stu" />
      </div>
    </section>
  );
}

function Line({
  title,
  values,
  weeks,
  cls,
}: {
  title: string;
  values: number[];
  weeks: string[];
  cls: string;
}) {
  const W = 520;
  const H = 150;
  const pad = { l: 34, r: 10, t: 10, b: 24 };
  const max = Math.max(1, ...values);
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / (values.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="dx-sub">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="dx-svg" role="img" aria-label={`${title} por semana`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        <polyline className={cls} fill="none" points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        {values.map((v, i) => (
          <g key={weeks[i]}>
            <circle className={cls} cx={x(i)} cy={y(v)} r={4} />
            {/* Larger invisible target so the tooltip is easy to hit. */}
            <circle cx={x(i)} cy={y(v)} r={12} fill="transparent">
              <title>{`Semana ${weekFmt.format(new Date(`${weeks[i]}T00:00:00Z`))}: ${v}`}</title>
            </circle>
            {i % 2 === 1 && (
              <text x={x(i)} y={H - 6} textAnchor="middle">
                {weekFmt.format(new Date(`${weeks[i]}T00:00:00Z`))}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}
