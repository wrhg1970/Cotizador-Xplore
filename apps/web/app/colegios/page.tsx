'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { fmtDate, fmtDateTime, STATUS_LABEL } from '../lib/types';
import type { RequestStatus } from '@ee/contracts';

interface School {
  officeId: string;
  officeCode: string;
  key: string;
  name: string;
  requests: number;
  won: number;
  lost: number;
  conversion: number | null;
  lastDeparture: string | null;
}

interface Detail {
  name: string;
  officeId: string;
  key: string;
  conversion: number | null;
  trips: {
    id: string;
    folio: string;
    groupName: string;
    status: RequestStatus;
    departureDate: string;
    participants: number;
    acceptedBy: { signerName: string; signerRole: string; acceptedAt: string } | null;
  }[];
  contacts: { id: string; name: string; role: string | null; email: string | null; phone: string | null }[];
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const href = (s: { officeId: string; key: string }) =>
  `/colegios?office=${s.officeId}&key=${encodeURIComponent(s.key)}`;

function SchoolList() {
  const [rows, setRows] = useState<School[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api<School[]>('/schools').then(setRows, (e) => setError(errorText(e)));
  }, []);
  const shown = (rows ?? []).filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <h1>Colegios</h1>
      <p className="muted">Por el nombre del cliente de cada solicitud, en tus oficinas.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label>
        Buscar
        <input value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="table-wrap">
        <table aria-label="Colegios">
          <thead>
            <tr>
              <th>Colegio</th>
              <th>Oficina</th>
              <th className="num">Solicitudes</th>
              <th className="num">Ganadas</th>
              <th className="num">Conversión</th>
              <th>Último viaje</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={`${s.officeId}-${s.key}`}>
                <td>
                  <Link href={href(s)}>{s.name}</Link>
                </td>
                <td>{s.officeCode}</td>
                <td className="num">{s.requests}</td>
                <td className="num">{s.won}</td>
                <td className="num">{pct(s.conversion)}</td>
                <td>{fmtDate(s.lastDeparture)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows && !shown.length && <p className="muted">Sin colegios todavía.</p>}
    </>
  );
}

function SchoolDetail({ officeId, schoolKey }: { officeId: string; schoolKey: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<Detail>(`/schools/detail?officeId=${officeId}&key=${encodeURIComponent(schoolKey)}`).then(
        setD,
        (e) => setError(errorText(e)),
      ),
    [officeId, schoolKey],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const opt = (k: string) => String(f.get(k) ?? '').trim() || undefined;
    setError(null);
    try {
      await api('/schools/contacts', {
        method: 'POST',
        body: {
          officeId,
          schoolName: d!.name,
          name: String(f.get('name')).trim(),
          role: opt('role'),
          email: opt('email'),
          phone: opt('phone'),
        },
      });
      form.reset();
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/schools/contacts/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!d) return error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>;
  const won = d.trips.filter((t) => t.status === 'WON').length;
  return (
    <>
      <p>
        <Link href="/colegios">← Colegios</Link>
      </p>
      <h1>{d.name}</h1>
      <p className="muted">
        {d.trips.length} solicitudes · {won} ganadas · conversión {pct(d.conversion)}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section aria-labelledby="viajes">
        <h2 id="viajes">Historial de viajes</h2>
        <div className="table-wrap">
          <table aria-label="Historial de viajes">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Grupo</th>
                <th>Salida</th>
                <th className="num">Estudiantes</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {d.trips.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/solicitudes/${t.id}`}>{t.folio}</Link>
                  </td>
                  <td>{t.groupName}</td>
                  <td>{fmtDate(t.departureDate)}</td>
                  <td className="num">{t.participants}</td>
                  <td>
                    {STATUS_LABEL[t.status]}
                    {t.acceptedBy && (
                      <span className="muted">
                        {' '}
                        · aceptó {t.acceptedBy.signerName} ({t.acceptedBy.signerRole}),{' '}
                        {fmtDateTime(t.acceptedBy.acceptedAt)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="contactos">
        <h2 id="contactos">Contactos</h2>
        <ul>
          {d.contacts.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong>
              {c.role && ` · ${c.role}`}
              {c.email && (
                <>
                  {' '}
                  · <a href={`mailto:${c.email}`}>{c.email}</a>
                </>
              )}
              {c.phone && ` · ${c.phone}`}{' '}
              <button className="secondary" onClick={() => void remove(c.id)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="row">
          <label>
            Nombre
            <input name="name" required maxLength={150} />
          </label>
          <label>
            Cargo
            <input name="role" maxLength={150} />
          </label>
          <label>
            Correo
            <input name="email" type="email" maxLength={200} />
          </label>
          <label>
            Teléfono
            <input name="phone" type="tel" maxLength={25} />
          </label>
          <button>Agregar contacto</button>
        </form>
      </section>
    </>
  );
}

function SchoolsPage() {
  const params = useSearchParams();
  const office = params.get('office');
  const key = params.get('key');
  return office && key ? <SchoolDetail officeId={office} schoolKey={key} /> : <SchoolList />;
}

/** Ficha por colegio: trips, conversion and contacts per school. */
export default function Page() {
  return (
    <Suspense>
      <SchoolsPage />
    </Suspense>
  );
}
