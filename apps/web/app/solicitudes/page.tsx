'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { fmtDate, fmtDateTime, STATUS_LABEL, type TravelRequestDto } from '../lib/types';

interface Page {
  items: TravelRequestDto[];
  total: number;
  page: number;
  limit: number;
}

function Inbox() {
  const params = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(params.get('q') ?? '');
  const assignedToMe = params.get('assignedToMe') === 'true';

  useEffect(() => {
    setError(null);
    api<Page>(`/requests?${params.toString()}`).then(setData, (e) => setError(errorText(e)));
  }, [params]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    router.push(`/solicitudes?${next.toString()}`);
  }

  const page = Number(params.get('page') ?? '1');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{assignedToMe ? 'Mis tareas' : 'Solicitudes'}</h1>
        <Link className="button" href="/solicitudes/nueva">
          Nueva solicitud
        </Link>
      </div>

      <form
        className="row card"
        role="search"
        style={{ marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          setParam('q', q.trim());
        }}
      >
        <label>
          Buscar
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Folio o nombre del grupo"
            maxLength={100}
          />
        </label>
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
        <button type="submit">Buscar</button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && data.items.length === 0 && <p className="muted">No hay solicitudes con estos filtros.</p>}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Folio</th>
                <th>Grupo</th>
                <th>Oficina</th>
                <th>Destino</th>
                <th>Salida</th>
                <th>Solicitante</th>
                <th>Responsable</th>
                <th>Estado</th>
                <th>Última actividad</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/solicitudes/${r.id}`}>{r.folio}</Link>
                  </td>
                  <td>{r.groupName}</td>
                  <td>{r.office.code}</td>
                  <td>
                    {r.city}, {r.countryCode}
                  </td>
                  <td>{fmtDate(r.departureDate)}</td>
                  <td>{r.requester.name}</td>
                  <td>{r.assignee?.name ?? '—'}</td>
                  <td>
                    <span className="badge">{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td>{fmtDateTime(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </>
  );
}

export default function RequestsPage() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}
