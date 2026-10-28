import { useState } from 'react';
import { downloadCsv } from '../../lib/csv';
import { ACTION_LABEL } from '../../lib/types';

export interface TimelineData {
  events: {
    id: string;
    action: string;
    actor: { id: string; name: string } | null;
    at: string;
    detail?: unknown;
  }[];
  comments: { id: string; body: string; author: { id: string; name: string }; createdAt: string }[];
}

type Kind = 'price' | 'state' | 'notes';
const KIND: Record<Kind, { title: string; hint: string }> = {
  price: { title: 'Cambios de precio', hint: 'Costos, rubros, tipos de cambio, comisión' },
  state: { title: 'Cambios de estado', hint: 'Flujo, autorización, envíos y cierre' },
  notes: { title: 'Notas y ajustes', hint: 'Comentarios, archivos, equipo, ligas' },
};
const PRICE = [
  'quote.version.updated',
  'quote.version.created',
  'quote.scenario.created',
  'quote.scenario.duplicated',
  'quote.import_previewed',
];
/** Status transitions the audit log implies, as people read them. */
const TRANSITION: Record<string, [string, string]> = {
  'request.submitted': ['Borrador', 'Por cotizar'],
  'request.assigned': ['Por cotizar', 'Cotizando'],
  'quote.submitted_for_approval': ['Borrador', 'En revisión'],
  'quote.approved': ['En revisión', 'Aprobada'],
  'quote.rejected_for_changes': ['En revisión', 'Devuelta'],
  'quote.sent': ['Aprobada', 'Enviada'],
  'request.won': ['Enviada', 'Ganada'],
  'request.lost': ['Enviada', 'Perdida'],
  'request.cancelled': ['Abierta', 'Cancelada'],
};
const kindOf = (action: string): Kind =>
  PRICE.includes(action) ? 'price' : TRANSITION[action] || action === 'request.created' ? 'state' : 'notes';

/** What changed, in words, from the event's audit detail (which never carries costs). */
function describe(detail: unknown): string {
  if (!detail || typeof detail !== 'object') return '';
  const d = detail as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(d.fields) && d.fields.length) parts.push(`Campos: ${d.fields.join(', ')}`);
  if (typeof d.lines === 'number') parts.push(`${d.lines} conceptos`);
  if (Array.isArray(d.fxRates))
    parts.push(
      `Tipos de cambio: ${(d.fxRates as { from: string; rate: string }[]).map((f) => `${f.from} ${f.rate}`).join(', ')}`,
    );
  for (const k of ['reason', 'comment', 'recipients', 'name', 'fileName'])
    if (typeof d[k] === 'string') parts.push(String(d[k]));
  return parts.join(' · ');
}

const dayFmt = new Intl.DateTimeFormat('es-MX', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** V2 per-file timeline over the append-only audit log: filters, search, timeline or table, CSV. */
export function Timeline({ data, folio }: { data: TimelineData | null; folio: string }) {
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [user, setUser] = useState('');
  const [newest, setNewest] = useState(true);
  const [table, setTable] = useState(false);
  if (!data) return <p className="muted">Cargando…</p>;

  const all = [
    ...data.events.map((e) => ({
      id: e.id,
      at: e.at,
      kind: kindOf(e.action),
      title: ACTION_LABEL[e.action] ?? e.action,
      detail: describe(e.detail),
      transition: TRANSITION[e.action],
      actor: e.actor?.name ?? 'Proceso automático',
    })),
    ...data.comments.map((c) => ({
      id: c.id,
      at: c.createdAt,
      kind: 'notes' as const,
      title: 'Comentario',
      detail: c.body,
      transition: undefined,
      actor: c.author.name,
    })),
  ];
  const users = [...new Set(all.map((e) => e.actor))].sort();
  const q = query.trim().toLowerCase();
  const shown = all
    .filter(
      (e) =>
        (kind === 'all' || e.kind === kind) &&
        (!user || e.actor === user) &&
        (!q || `${e.title} ${e.detail} ${e.actor} ${e.id}`.toLowerCase().includes(q)),
    )
    .sort((a, b) => (newest ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)));
  const days = shown.reduce<Map<string, typeof shown>>((m, e) => {
    const k = dayFmt.format(new Date(e.at));
    m.set(k, [...(m.get(k) ?? []), e]);
    return m;
  }, new Map());
  const count = (k: Kind) => all.filter((e) => e.kind === k).length;

  return (
    <section className="card" aria-labelledby="linea">
      <div className="section-head">
        <div>
          <h2 id="linea" style={{ margin: 0 }}>
            Línea de tiempo y bitácora del expediente {folio}{' '}
            <span className="pill dark">Bitácora inalterable</span>
          </h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Cambios de precio, de estado y notas en orden cronológico. La bitácora no se puede editar ni
            borrar.
          </p>
        </div>
        <div className="row">
          <div className="tabs" style={{ margin: 0 }} role="group" aria-label="Vista">
            <button type="button" aria-pressed={!table} onClick={() => setTable(false)}>
              Línea de tiempo
            </button>
            <button type="button" aria-pressed={table} onClick={() => setTable(true)}>
              Tabla
            </button>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              downloadCsv(`${folio}-linea-de-tiempo.csv`, [
                ['Fecha', 'Tipo', 'Evento', 'Detalle', 'Transición', 'Usuario', 'ID evento'],
                ...shown.map((e) => [
                  e.at,
                  KIND[e.kind].title,
                  e.title,
                  e.detail,
                  e.transition ? e.transition.join(' → ') : '',
                  e.actor,
                  e.id,
                ]),
              ])
            }
          >
            Exportar CSV
          </button>
        </div>
      </div>
      <div className="filters" role="group" aria-label="Filtrar por tipo">
        <button type="button" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
          <span>
            <strong>Todas las acciones</strong>
            <small>Historial completo del folio</small>
          </span>
          <b>{all.length}</b>
        </button>
        {(Object.keys(KIND) as Kind[]).map((k) => (
          <button key={k} type="button" className={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
            <span>
              <strong>{KIND[k].title}</strong>
              <small>{KIND[k].hint}</small>
            </span>
            <b>{count(k)}</b>
          </button>
        ))}
      </div>
      <div className="row" style={{ margin: '12px 0' }}>
        <label style={{ flex: 1 }}>
          Buscar
          <input
            type="search"
            value={query}
            placeholder="Evento, detalle, usuario o ID"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Usuario
          <select value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">Todos ({users.length})</option>
            {users.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <label>
          Orden
          <select value={newest ? 'new' : 'old'} onChange={(e) => setNewest(e.target.value === 'new')}>
            <option value="new">Más recientes primero</option>
            <option value="old">Más antiguos primero</option>
          </select>
        </label>
      </div>
      <p className="muted">
        Mostrando {shown.length} de {all.length} registros
      </p>
      {table ? (
        <div className="table-wrap">
          <table aria-label="Bitácora del expediente">
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Tipo</th>
                <th>Evento</th>
                <th>Detalle</th>
                <th>Usuario</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.at).toLocaleString('es-MX')}</td>
                  <td>{KIND[e.kind].title}</td>
                  <td>
                    {e.title}
                    {e.transition && ` (${e.transition.join(' → ')})`}
                  </td>
                  <td>{e.detail}</td>
                  <td>{e.actor}</td>
                  <td>
                    <code>{e.id.slice(0, 8)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        [...days].map(([day, items]) => (
          <div key={day} className="tl-day">
            <h3>
              {day} <span className="muted">· {items.length} eventos</span>
            </h3>
            <ol className="tl">
              {items.map((e) => (
                <li key={e.id} className={e.kind}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      <span className="pill">{KIND[e.kind].title}</span>{' '}
                      <span className="muted">{timeFmt.format(new Date(e.at))}</span>
                    </span>
                    <code className="muted">ID {e.id.slice(0, 8)}</code>
                  </div>
                  <strong>{e.title}</strong>
                  {e.detail && <p style={{ margin: '2px 0', whiteSpace: 'pre-wrap' }}>{e.detail}</p>}
                  {e.transition && (
                    <p className="transition">
                      Transición: <span>{e.transition[0]}</span> → <b>{e.transition[1]}</b>
                    </p>
                  )}
                  <small className="muted">{e.actor}</small>
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}
