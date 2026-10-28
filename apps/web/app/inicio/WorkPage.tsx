'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import type { RequestStatus } from '@ee/contracts';
import { fmtDate, STATUS_LABEL } from '../lib/types';
import { useMe } from '../lib/useMe';

type TaskKind = 'SUBMIT_REQUEST' | 'ASSIGN' | 'QUOTE' | 'FIX_QUOTE' | 'APPROVE' | 'SEND' | 'RECORD_OUTCOME';
type Stage = 1 | 2 | 3 | 4;

interface Task {
  kind: TaskKind;
  requestId: string;
  folio: string;
  groupName: string;
  officeCode: string;
  dueDate: string | null;
  departureDate: string;
  quoteId: string | null;
  quoteLabel: string | null;
}

interface WorkRequest {
  id: string;
  folio: string;
  status: RequestStatus;
  stage: Stage;
  officeCode: string;
  city: string;
  countryCode: string;
  departureDate: string;
  groupName: string;
  clientName: string | null;
  program: string | null;
  participants: number;
  chaperones: number;
  scenarios: number;
  price: { amount: string; currency: string } | null;
  role: 'REQUESTER' | 'ASSIGNEE' | 'COMMERCIAL' | 'SUPPORT';
}

type AlertKind = 'UNQUOTED' | 'REVIEW_PENDING' | 'SENT_NO_ANSWER' | 'PAYMENT_DUE';
interface Alert {
  kind: AlertKind;
  requestId: string;
  folio: string;
  groupName: string;
  quoteId: string | null;
  detail: string;
}
const ALERT_LABEL: Record<AlertKind, string> = {
  UNQUOTED: 'Solicitud sin cotizar',
  REVIEW_PENDING: 'Autorización pendiente',
  SENT_NO_ANSWER: 'Propuesta sin respuesta',
  PAYMENT_DUE: 'Pago por vencer',
};

interface Dashboard {
  alerts: Alert[];
  tasks: Task[];
  offices: { id: string; code: string; name: string; byStatus: Partial<Record<RequestStatus, number>> }[];
  requests: WorkRequest[];
}

const TASK_LABEL: Record<TaskKind, string> = {
  SUBMIT_REQUEST: 'Enviar a cotización',
  ASSIGN: 'Asignar cotizador',
  QUOTE: 'Cotizar',
  FIX_QUOTE: 'Corregir cotización devuelta',
  APPROVE: 'Revisar y autorizar cotización',
  SEND: 'Enviar propuesta al colegio',
  RECORD_OUTCOME: 'Registrar respuesta del colegio',
};

const TASK_HINT: Record<TaskKind, string> = {
  SUBMIT_REQUEST: 'Completa la solicitud y envíala a cotizar.',
  ASSIGN: 'Asigna un cotizador a esta solicitud.',
  QUOTE: 'Arma los escenarios y manda la cotización a autorizar.',
  FIX_QUOTE: 'La cotización regresó con comentarios; corrígela y reenvíala.',
  APPROVE: 'Revisa la cotización y autorízala o devuélvela.',
  SEND: 'La propuesta está autorizada; envíala al colegio.',
  RECORD_OUTCOME: 'Registra si el colegio aceptó o rechazó la propuesta.',
};

const STAGES: { stage: Stage; name: string; about: string; waiting: string }[] = [
  {
    stage: 1,
    name: 'Solicitada',
    about: 'En captura, por asignar o cotizándose.',
    waiting: 'En espera de la cotización.',
  },
  {
    stage: 2,
    name: 'Cotizada',
    about: 'Cotizaciones en revisión o devueltas para corregir.',
    waiting: 'En espera de autorización.',
  },
  {
    stage: 3,
    name: 'Aprobada',
    about: 'Autorizadas y listas para enviar al colegio.',
    waiting: 'Lista para enviarse al colegio.',
  },
  {
    stage: 4,
    name: 'Enviada',
    about: 'Propuestas con el colegio y viajes ganados.',
    waiting: 'En espera de la respuesta del colegio.',
  },
];

const ROLE_LABEL: Record<WorkRequest['role'], string> = {
  REQUESTER: 'Ejecutivo titular de la solicitud',
  ASSIGNEE: 'Cotizador titular',
  COMMERCIAL: 'Ejecutivo comercial titular',
  SUPPORT: 'Comité / apoyo',
};

type Filter = 'ALL' | 'MINE' | 'OWNER' | 'SUPPORT';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'Todas' },
  { key: 'MINE', label: 'Mi turno hoy' },
  { key: 'OWNER', label: 'Soy titular' },
  { key: 'SUPPORT', label: 'Comité / apoyo' },
];

const money = (p: WorkRequest['price']) =>
  p &&
  `${new Intl.NumberFormat('es-MX', { style: 'currency', currency: p.currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(Number(p.amount))} ${p.currency} por alumno`;

const needs = (n: number) => (n === 1 ? '1 requiere tu acción' : `${n} requieren tu acción`);

// Pipeline order of the EE process; closed states go last.
const STATUSES: RequestStatus[] = ['DRAFT', 'SUBMITTED', 'QUOTING', 'SENT', 'WON', 'LOST', 'CANCELLED'];

/** Won ÷ (won + lost): only proposals the client already answered count. */
const conversion = (s: Partial<Record<RequestStatus, number>>) => {
  const won = s.WON ?? 0;
  const answered = won + (s.LOST ?? 0);
  return answered ? `${Math.round((won / answered) * 100)}%` : '—';
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
};

const taskHref = (t: Task) => (t.quoteId ? `/cotizaciones/${t.quoteId}` : `/solicitudes/${t.requestId}`);

function WorkCard({ r, tasks, compact }: { r: WorkRequest; tasks: Task[]; compact: boolean }) {
  const stage = STAGES[r.stage - 1]!;
  const next = tasks[0];
  return (
    <article className="card wcard" aria-label={`${r.folio} ${r.groupName}`}>
      <div className="eyebrow">
        {r.folio} · {r.officeCode} · {r.city}, {r.countryCode} · {fmtDate(r.departureDate)}
      </div>
      <h3>{r.clientName ? `${r.clientName} — ${r.groupName}` : r.groupName}</h3>
      <div className="muted">
        {[r.program, `${r.participants} alum. + ${r.chaperones} chap.`, money(r.price)]
          .filter(Boolean)
          .join(' · ')}
      </div>
      <div className="stagebar">
        <span>
          Etapa actual: 0{r.stage}. {stage.name}
        </span>
        <span className="badge">{STATUS_LABEL[r.status]}</span>
      </div>
      {!compact && (
        <>
          <ol className="stepper" aria-label="Etapas">
            {STAGES.map((s) => (
              <li
                key={s.stage}
                className={s.stage < r.stage ? 'done' : s.stage === r.stage ? 'current' : undefined}
                aria-current={s.stage === r.stage ? 'step' : undefined}
              >
                {s.stage < r.stage ? '✓ ' : ''}
                {s.name}
              </li>
            ))}
          </ol>
          <div className={next ? 'rolebox act' : 'rolebox'}>
            <div>
              <strong>Rol:</strong> {ROLE_LABEL[r.role]}
            </div>
            {next ? (
              <div>
                <strong>Requiere tu acción:</strong> {TASK_HINT[next.kind]}
              </div>
            ) : (
              <div className="muted">
                {r.status === 'WON' ? 'Viaje ganado.' : stage.waiting} Sin acción tuya por ahora.
              </div>
            )}
          </div>
        </>
      )}
      <div className="foot">
        <span className="muted">{r.scenarios === 1 ? '1 escenario' : `${r.scenarios} escenarios`}</span>
        <span className="row">
          {tasks.map((t) => (
            <Link key={`${t.kind}-${t.quoteId ?? ''}`} className="button" href={taskHref(t)}>
              {TASK_LABEL[t.kind]}
              {t.quoteLabel ? ` (${t.quoteLabel})` : ''} →
            </Link>
          ))}
          {!tasks.length && (
            <Link className="button secondary" href={`/solicitudes/${r.id}`}>
              {r.status === 'WON' ? 'Ver cierre y plan de pagos →' : 'Ver solicitud →'}
            </Link>
          )}
        </span>
      </div>
    </article>
  );
}

type View = 'ROWS' | 'COMPACT' | 'KANBAN';

/** "Inicio" opens it as a list, "Mi Dashboard" as the Kanban board. */
export function WorkPage({ initialView }: { initialView: View }) {
  const me = useMe();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<Filter>('ALL');
  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState('');

  const tasksOf = (id: string) => data?.tasks.filter((t) => t.requestId === id) ?? [];
  const PASSES: Record<Filter, (r: WorkRequest) => boolean> = {
    ALL: () => true,
    MINE: (r) => tasksOf(r.id).length > 0,
    OWNER: (r) => r.role !== 'SUPPORT',
    SUPPORT: (r) => r.role === 'SUPPORT',
  };
  const q = query.trim().toLowerCase();
  const shown = (data?.requests ?? [])
    .filter(PASSES[filter])
    .filter(
      (r) =>
        !q ||
        [
          r.folio,
          r.clientName,
          r.groupName,
          r.city,
          r.countryCode,
          ...tasksOf(r.id).map((t) => TASK_LABEL[t.kind]),
        ]
          .join(' ')
          .toLowerCase()
          .includes(q),
    );

  useEffect(() => {
    api<Dashboard>('/dashboard').then(setData, (e) => setError(errorText(e)));
  }, []);

  return (
    <>
      <div className="row greeting" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{me ? `${greeting()}, ${me.name.split(' ')[0]}.` : 'Mi trabajo'}</h1>
          {data && (
            <p>
              {data.tasks.length === 0 ? (
                'No tienes pendientes por ahora.'
              ) : (
                <>
                  Tienes{' '}
                  <strong>
                    {data.tasks.length === 1 ? '1 pendiente' : `${data.tasks.length} pendientes`}
                  </strong>{' '}
                  en tus solicitudes.
                </>
              )}
            </p>
          )}
        </div>
        <Link className="button" href="/solicitudes/nueva">
          Nueva solicitud
        </Link>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && data.alerts.length > 0 && (
        <section className="card" aria-labelledby="alertas" style={{ marginBottom: 16 }}>
          <h2 id="alertas" style={{ marginTop: 0 }}>
            Atrasados ({data.alerts.length})
          </h2>
          <ul>
            {data.alerts.map((a, i) => (
              <li key={`${a.kind}-${a.requestId}-${i}`}>
                <strong>{ALERT_LABEL[a.kind]}</strong> ·{' '}
                <Link href={a.quoteId ? `/cotizaciones/${a.quoteId}` : `/solicitudes/${a.requestId}`}>
                  {a.folio} {a.groupName}
                </Link>{' '}
                <span className="muted">· {a.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && (
        <>
          <section className="stages" aria-label="Etapas">
            {STAGES.map((s) => {
              const inStage = data.requests.filter((r) => r.stage === s.stage);
              const due = inStage.filter((r) => tasksOf(r.id).length).length;
              return (
                <div key={s.stage} className="card stage">
                  <div className="eyebrow">Etapa 0{s.stage} de 04</div>
                  <h2 style={{ margin: '2px 0 0' }}>{s.name}</h2>
                  <div className="count">{inStage.length}</div>
                  <div className="muted">{s.about}</div>
                  <div className={due ? 'due' : 'clear'}>{due ? needs(due) : 'Al día en esta etapa'}</div>
                </div>
              );
            })}
          </section>
          <section aria-labelledby="pendientes" style={{ marginBottom: 16 }}>
            <h2 id="pendientes" hidden>
              Mis solicitudes
            </h2>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="tabs" role="group" aria-label="Filtro" style={{ margin: 0 }}>
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label} ({data.requests.filter(PASSES[f.key]).length})
                  </button>
                ))}
              </div>
              <div className="tabs" role="group" aria-label="Vista" style={{ margin: 0 }}>
                {(
                  [
                    ['ROWS', 'Filas'],
                    ['COMPACT', 'Tarjetas comprimidas'],
                    ['KANBAN', 'Tablero por etapa'],
                  ] as const
                ).map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="search"
              aria-label="Buscar"
              placeholder="Buscar folio, colegio, destino o tarea…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: '100%', margin: '12px 0' }}
            />
            {shown.length === 0 ? (
              <p className="muted">
                {data.requests.length ? 'Nada coincide con el filtro.' : 'No tienes solicitudes abiertas.'}
              </p>
            ) : view === 'KANBAN' ? (
              <div className="kanban">
                {STAGES.map((s) => {
                  const col = shown.filter((r) => r.stage === s.stage);
                  return (
                    <section key={s.stage} aria-label={`Etapa ${s.name}`}>
                      <h3>
                        0{s.stage}. {s.name} <span className="muted">({col.length})</span>
                      </h3>
                      <div className="wcards compact">
                        {col.map((r) => (
                          <WorkCard key={r.id} r={r} tasks={tasksOf(r.id)} compact />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className={view === 'COMPACT' ? 'wcards compact' : 'wcards'}>
                {shown.map((r) => (
                  <WorkCard key={r.id} r={r} tasks={tasksOf(r.id)} compact={view === 'COMPACT'} />
                ))}
              </div>
            )}
          </section>
          <section className="card" aria-labelledby="oficinas">
            <h2 id="oficinas" style={{ marginTop: 0 }}>
              Solicitudes por oficina
            </h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Oficina</th>
                    {STATUSES.map((s) => (
                      <th key={s} className="num">
                        {STATUS_LABEL[s]}
                      </th>
                    ))}
                    <th className="num">Conversión</th>
                  </tr>
                </thead>
                <tbody>
                  {data.offices.map((o) => (
                    <tr key={o.id}>
                      <th scope="row">
                        {o.code} · {o.name}
                      </th>
                      {STATUSES.map((s) => (
                        <td key={s} className="num">
                          {o.byStatus[s] ? (
                            <Link href={`/solicitudes?status=${s}&officeId=${o.id}`}>{o.byStatus[s]}</Link>
                          ) : (
                            0
                          )}
                        </td>
                      ))}
                      <td className="num">{conversion(o.byStatus)}</td>
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
