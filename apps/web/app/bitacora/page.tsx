'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { ACTION_LABEL, fmtDateTime } from '../lib/types';

interface Entry {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: { id: string; name: string; email: string } | null;
  office: string | null;
  diff: unknown;
  correlationId: string;
}
interface Page {
  items: Entry[];
  total: number;
  page: number;
  limit: number;
}
interface Office {
  id: string;
  code: string;
  name: string;
}

const GROUPS: [string, string][] = [
  ['', 'Todas'],
  ['request.', 'Solicitudes'],
  ['quote.', 'Cotizaciones'],
  ['quote.approved', 'Autorizaciones'],
  ['quote.sent', 'Envíos al cliente'],
  ['quote_template.', 'Plantillas'],
  ['user.', 'Usuarios y roles'],
  ['role_policy.', 'Permisos por rol'],
  ['concept_template.', 'Catálogo de rubros'],
  ['office.', 'Oficinas'],
  ['auth.', 'Inicios de sesión'],
];
const FILTERS = ['officeId', 'action', 'actorEmail', 'entityId', 'from', 'to'] as const;

const recordLink = (e: Entry) =>
  e.entityType === 'TravelRequest'
    ? `/solicitudes/${e.entityId}`
    : e.entityType === 'QuoteVersion'
      ? `/cotizaciones/${e.entityId}`
      : null;

function AuditLog() {
  const params = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null);
  const [offices, setOffices] = useState<Office[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api<Page>(`/audit-logs?${params.toString()}`).then(setData, (e) => setError(errorText(e)));
  }, [params]);
  useEffect(() => {
    api<Office[]>('/offices').then(setOffices, () => setOffices([]));
  }, []);

  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const k of FILTERS) {
      const v = String(f.get(k) ?? '').trim();
      if (v) next.set(k, v);
    }
    router.push(`/bitacora?${next.toString()}`);
  }
  function goTo(page: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    router.push(`/bitacora?${next.toString()}`);
  }

  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <h1>Bitácora</h1>
      <p className="muted">
        Registro de solo lectura de quién hizo qué y cuándo. Nadie puede editarlo ni borrarlo. Coordinadores y
        auditores ven su oficina; el administrador del sistema ve todo, incluidos inicios de sesión y
        permisos.
      </p>
      <form className="row card" role="search" onSubmit={search} style={{ marginBottom: 16 }}>
        <label>
          Oficina
          <select name="officeId" defaultValue={params.get('officeId') ?? ''}>
            <option value="">Todas</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select name="action" defaultValue={params.get('action') ?? ''}>
            {GROUPS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Persona (correo)
          <input
            name="actorEmail"
            type="email"
            maxLength={254}
            defaultValue={params.get('actorEmail') ?? ''}
          />
        </label>
        <label>
          ID del registro
          <input name="entityId" maxLength={64} defaultValue={params.get('entityId') ?? ''} />
        </label>
        <label>
          Desde
          <input name="from" type="date" defaultValue={params.get('from') ?? ''} />
        </label>
        <label>
          Hasta
          <input name="to" type="date" defaultValue={params.get('to') ?? ''} />
        </label>
        <button type="submit">Buscar</button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && data.items.length === 0 && <p className="muted">No hay movimientos con estos filtros.</p>}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Persona</th>
                <th>Acción</th>
                <th>Oficina</th>
                <th>Registro</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => {
                const href = recordLink(e);
                return (
                  <tr key={e.id}>
                    <td>{fmtDateTime(e.at)}</td>
                    <td>{e.actor ? <span title={e.actor.email}>{e.actor.name}</span> : 'Sistema'}</td>
                    <td>{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td>{e.office ?? '—'}</td>
                    <td>
                      {href ? <Link href={href}>Abrir</Link> : <span className="muted">{e.entityType}</span>}
                    </td>
                    <td>
                      {e.diff ? (
                        <details>
                          <summary>Ver cambios</summary>
                          <pre style={{ whiteSpace: 'pre-wrap', maxWidth: 480 }}>
                            {JSON.stringify(e.diff, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && pages > 1 && (
        <nav className="row" aria-label="Paginación" style={{ marginTop: 12 }}>
          <button className="secondary" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            Anterior
          </button>
          <span className="muted">
            Página {page} de {pages} · {data.total} movimientos
          </span>
          <button className="secondary" disabled={page >= pages} onClick={() => goTo(page + 1)}>
            Siguiente
          </button>
        </nav>
      )}
    </>
  );
}

export default function AuditLogPage() {
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  );
}
