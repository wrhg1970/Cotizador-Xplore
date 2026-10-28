'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { fmtDate, STATUS_LABEL, type TravelRequestDto } from '../lib/types';
import { canSeeQuotes, useMe } from '../lib/useMe';

/** "Mi trabajo" stage from the API: 1 Solicitada, 2 Por aprobar, 3 Aprobada, 4 Enviada. */
type Row = TravelRequestDto & { scenarios: number; stage: 1 | 2 | 3 | 4 };

interface Page {
  items: Row[];
  total: number;
  page: number;
  limit: number;
}

/** V2 tabs; the API filters by `stage`. */
const TABS = [
  ['', 'Todas'],
  ['QUOTING', 'En cotización'],
  ['APPROVAL', 'Por aprobar'],
  ['SENT', 'Enviadas / negociación'],
  ['WON', 'Aceptadas'],
] as const;

const VIEWS = [
  ['ROWS', 'Filas'],
  ['CARDS', 'Tarjetas'],
  ['KANBAN', 'Kanban'],
] as const;
type View = (typeof VIEWS)[number][0];

/** Process steps (Kanban columns); lost and cancelled requests go to the last one. */
const STEPS = ['Solicitada', 'Por aprobar', 'Aprobada', 'Enviada / negociación', 'Aceptada', 'Cerrada'];
const stepOf = (r: Row) =>
  r.status === 'WON'
    ? 5
    : r.status === 'SENT'
      ? 4
      : r.status === 'LOST' || r.status === 'CANCELLED'
        ? 6
        : r.stage;
const stepName = (r: Row) => {
  const n = stepOf(r);
  return n === 6 ? STATUS_LABEL[r.status] : `0${n}. ${STEPS[n - 1]}`;
};

const LIMIT = 50;

function Inbox() {
  const params = useSearchParams();
  const router = useRouter();
  const me = useMe();
  const [data, setData] = useState<Page | null>(null);
  const [offices, setOffices] = useState<{ id: string; code: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(params.get('q') ?? '');
  const assignedToMe = params.get('assignedToMe') === 'true';
  const view: View = VIEWS.some(([k]) => k === params.get('vista')) ? (params.get('vista') as View) : 'ROWS';
  const advanced = !!(params.get('status') || params.get('officeId') || assignedToMe);
  const [showFilters, setShowFilters] = useState(advanced);

  useEffect(() => {
    setError(null);
    const query = new URLSearchParams(params);
    query.delete('vista');
    query.set('limit', String(LIMIT));
    // Fast tab or search changes: only the latest answer may land.
    let current = true;
    api<Page>(`/requests?${query.toString()}`).then(
      (d) => current && setData(d),
      (e) => current && setError(errorText(e)),
    );
    return () => {
      current = false;
    };
  }, [params]);
  useEffect(() => {
    api<typeof offices>('/offices').then(setOffices, () => undefined);
  }, []);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    router.push(`/solicitudes?${next.toString()}`);
  }

  const page = Number(params.get('page') ?? '1');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const stage = params.get('stage') ?? '';

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>{assignedToMe ? 'Mis tareas' : 'Solicitudes'}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Expedientes en filas, tarjetas o Kanban; abre la ficha para cotizar, comparar o autorizar.
          </p>
        </div>
        <Link className="button" href="/solicitudes/nueva">
          Nueva solicitud
        </Link>
      </div>

      <section className="card" style={{ marginBottom: 16 }} aria-label="Filtros">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="tabs" role="group" aria-label="Etapa" style={{ margin: 0 }}>
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={stage === key}
                onClick={() => setParam('stage', key)}
              >
                {label}
                {stage === key && data ? ` (${data.total})` : ''}
              </button>
            ))}
          </div>
          <form
            role="search"
            className="row"
            style={{ alignItems: 'center', gap: 8, flex: '1 1 320px', justifyContent: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              setParam('q', q.trim());
            }}
          >
            <input
              type="search"
              aria-label="Buscar"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar folio, colegio o destino…"
              style={{ flex: '1 1 220px', maxWidth: 360 }}
              maxLength={100}
            />
            <button
              type="button"
              className="secondary"
              aria-expanded={showFilters}
              aria-controls="filtros-avanzados"
              onClick={() => setShowFilters(!showFilters)}
            >
              Filtros avanzados
            </button>
          </form>
        </div>
        {showFilters && (
          <div id="filtros-avanzados" className="row" style={{ marginTop: 12 }}>
            <label>
              Estado
              <select value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Oficina
              <select
                value={params.get('officeId') ?? ''}
                onChange={(e) => setParam('officeId', e.target.value)}
              >
                <option value="">Todas</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} · {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="row" style={{ alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={assignedToMe}
                onChange={(e) => setParam('assignedToMe', e.target.checked ? 'true' : '')}
              />
              Solo asignadas a mí
            </label>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="expedientes">
        <div
          className="row"
          style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}
        >
          <h2 id="expedientes" style={{ margin: 0 }}>
            Expedientes{data ? ` (${data.total})` : ''}
          </h2>
          <div className="tabs" role="group" aria-label="Vista" style={{ margin: 0 }}>
            {VIEWS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setParam('vista', key === 'ROWS' ? '' : key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {data && data.items.length === 0 && <p className="muted">No hay solicitudes con estos filtros.</p>}
        {data && data.items.length > 0 && view === 'ROWS' && (
          <div className="table-wrap">
            <table className="req-table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Grupo / institución</th>
                  <th>Oficina</th>
                  <th>Destino</th>
                  <th className="num">Alumnos</th>
                  <th className="num">Esc.</th>
                  <th>Entrega</th>
                  <th>Etapa</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/solicitudes/${r.id}`}>{r.folio}</Link>
                    </td>
                    <td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                      <Who r={r} />
                    </td>
                    <td>{r.office.code}</td>
                    <td style={{ whiteSpace: 'normal' }}>
                      {r.city}, {r.countryCode}
                    </td>
                    <td className="num">
                      {r.participants} + {r.chaperones} chap.
                    </td>
                    <td className="num">{r.scenarios}</td>
                    <td>{fmtDate(r.dueDate)}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 120 }}>
                      <strong>{stepName(r)}</strong>
                      <div className="muted">{STATUS_LABEL[r.status]}</div>
                    </td>
                    <td className="req-actions">
                      <Actions r={r} quotes={canSeeQuotes(me, r.office.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.items.length > 0 && view === 'CARDS' && (
          <div className="wcards compact">
            {data.items.map((r) => (
              <RequestCard key={r.id} r={r} quotes={canSeeQuotes(me, r.office.id)} />
            ))}
          </div>
        )}
        {data && data.items.length > 0 && view === 'KANBAN' && (
          <div
            className="kanban"
            style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(250px, 1fr))` }}
          >
            {STEPS.map((name, i) => {
              const col = data.items.filter((r) => stepOf(r) === i + 1);
              return (
                <section key={name} aria-label={`Etapa ${name}`}>
                  <h3>
                    {i < 5 ? `0${i + 1}. ` : ''}
                    {name} <span className="muted">({col.length})</span>
                  </h3>
                  <div className="wcards compact">
                    {col.map((r) => (
                      <RequestCard key={r.id} r={r} quotes={canSeeQuotes(me, r.office.id)} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {data && pages > 1 && (
          <nav className="row" aria-label="Paginación" style={{ marginTop: 12 }}>
            <button
              className="secondary"
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
            >
              Anterior
            </button>
            <span className="muted">
              Página {page} de {pages}
            </span>
            <button
              className="secondary"
              disabled={page >= pages}
              onClick={() => setParam('page', String(page + 1))}
            >
              Siguiente
            </button>
          </nav>
        )}
      </section>
    </>
  );
}

function Who({ r }: { r: Row }) {
  return (
    <>
      <strong>{r.clientName ? `${r.clientName} — ${r.groupName}` : r.groupName}</strong>
      <div className="muted">
        {r.program ? `${r.program} · ` : ''}Solicita: {r.requester.name}
      </div>
    </>
  );
}

/** Cotizar and Comparar both land on the request's scenarios (the comparison table lives there). */
function Actions({ r, quotes }: { r: Row; quotes: boolean }) {
  const open = r.status === 'SUBMITTED' || r.status === 'QUOTING';
  return (
    <span className="row" style={{ gap: 6, alignItems: 'center' }}>
      {quotes && open && (
        <Link className="button req-act" href={`/solicitudes/${r.id}#escenarios`}>
          Cotizar
        </Link>
      )}
      {r.scenarios > 1 && (
        <Link className="button secondary req-act" href={`/solicitudes/${r.id}#escenarios`}>
          Comparar
        </Link>
      )}
      <Link className="req-act" href={`/solicitudes/${r.id}`}>
        Ficha →
      </Link>
    </span>
  );
}

function RequestCard({ r, quotes }: { r: Row; quotes: boolean }) {
  return (
    <article className="card wcard" aria-label={`${r.folio} ${r.groupName}`}>
      <div className="eyebrow">
        {r.folio} · {r.office.code} · Entrega {fmtDate(r.dueDate)}
      </div>
      <Who r={r} />
      <div className="muted">
        {r.city}, {r.countryCode} · {r.participants} + {r.chaperones} chap. ·{' '}
        {r.scenarios === 1 ? '1 escenario' : `${r.scenarios} escenarios`}
      </div>
      <div className="foot" style={{ marginTop: 10 }}>
        <span className="badge">{stepName(r)}</span>
        <Actions r={r} quotes={quotes} />
      </div>
    </article>
  );
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<p className="muted">Cargando…</p>}>
      <Inbox />
    </Suspense>
  );
}
