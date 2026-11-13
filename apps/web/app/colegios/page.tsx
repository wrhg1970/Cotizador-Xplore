'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import type { RequestStatus } from '@ee/contracts';
import { api, errorText } from '../lib/api';
import { fmtDate, fmtDateTime, STATUS_LABEL } from '../lib/types';
import { can, useMe } from '../lib/useMe';
import { matchesSearch, officeOptions, TrayFilters } from '../TrayFilters';
import { type Contact, ContactsTab, FichaStrip, FichaTabs, WissifyBadge, WissifyTab } from '../Ficha';

/** The ficha's own data (pestaña Datos); all null while the school only exists in requests. */
interface ClientData {
  kind: string | null;
  legalName: string | null;
  taxId: string | null;
  levels: string | null;
  website: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  notes: string | null;
  active: boolean;
  wissifyId: string | null;
  wissifySyncedAt: string | null;
}

interface School extends ClientData {
  officeId: string;
  officeCode: string;
  officeName: string;
  key: string;
  name: string;
  requests: number;
  won: number;
  lost: number;
  conversion: number | null;
  lastDeparture: string | null;
  contact: { name: string; role: string | null } | null;
}

interface Detail extends ClientData {
  name: string;
  officeId: string;
  key: string;
  conversion: number | null;
  canEdit: boolean;
  trips: {
    id: string;
    folio: string;
    groupName: string;
    status: RequestStatus;
    departureDate: string;
    participants: number;
    acceptedBy: { signerName: string; signerRole: string; acceptedAt: string } | null;
  }[];
  contacts: Contact[];
}

const KINDS = ['Colegio', 'Universidad', 'Empresa', 'Otro'];
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const href = (s: { officeId: string; key: string }) =>
  `/colegios?office=${s.officeId}&key=${encodeURIComponent(s.key)}`;
const place = (s: ClientData) => [s.city, s.state].filter(Boolean).join(', ');

function NewClient({ offices, onCancel }: { offices: [string, string][]; onCancel: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      const r = await api<{ officeId: string; key: string }>('/schools/client', {
        method: 'PUT',
        body: { officeId: f.get('officeId'), name: String(f.get('name')).trim(), kind: f.get('kind') },
      });
      router.push(href(r));
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <section className="card" aria-label="Nuevo cliente">
      <form onSubmit={(e) => void create(e)} className="row">
        <label>
          Nombre
          <input name="name" required maxLength={200} autoFocus />
        </label>
        <label>
          Oficina
          <select name="officeId" required>
            {offices.map(([id, text]) => (
              <option key={id} value={id}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select name="kind" defaultValue="Colegio">
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <button>Crear cliente</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancelar
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function SchoolList() {
  const params = useSearchParams();
  const me = useMe();
  const [all, setAll] = useState<School[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'ROWS' | 'CARDS'>('ROWS');
  const [adding, setAdding] = useState(false);
  const [offices, setOffices] = useState<{ id: string; code: string; name: string }[]>([]);
  useEffect(() => {
    api<School[]>('/schools').then(setAll, (e) => setError(errorText(e)));
    api<typeof offices>('/offices').then(setOffices, () => undefined);
  }, []);
  const p = (k: string) => params.get(k) ?? '';
  const rows = all?.filter(
    (s) =>
      (!p('tipo') || (s.kind ?? 'Colegio') === p('tipo')) &&
      (!p('oficina') || s.officeCode === p('oficina')) &&
      (!p('estado') || (p('estado') === 'ACTIVE') === s.active) &&
      (!p('wissify') || (p('wissify') === 'LINKED') === !!s.wissifyId) &&
      (!p('vendidas') || s.won > 0) &&
      matchesSearch(p('q'), [s.name, s.legalName, s.taxId, s.city, s.state, s.contact?.name]),
  );
  const myOffices = offices
    .filter((o) => can(me, o.id, 'canCreate'))
    .map((o) => [o.id, `${o.code} · ${o.name}`] as [string, string]);

  return (
    <>
      <section className="card tray-head">
        <div>
          <h1>Clientes</h1>
          <p className="muted">
            Colegios y otros clientes de tus oficinas, con su historial de viajes y contactos
          </p>
        </div>
        <div className="row">
          <div className="tabs" role="group" aria-label="Vista">
            {(
              [
                ['ROWS', 'Filas'],
                ['CARDS', 'Tarjetas'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>
                {label}
              </button>
            ))}
          </div>
          {!adding && myOffices.length > 0 && (
            <button type="button" onClick={() => setAdding(true)}>
              + Nuevo cliente
            </button>
          )}
        </div>
      </section>
      {adding && <NewClient offices={myOffices} onCancel={() => setAdding(false)} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!all && !error && <p className="muted">Cargando…</p>}
      <TrayFilters
        placeholder="Buscar cliente, ciudad, RFC o contacto…"
        selects={[
          { key: 'tipo', label: 'Tipo', options: KINDS.map((k) => [k, k] as const) },
          { key: 'oficina', label: 'Oficina', options: officeOptions(all ?? []) },
          {
            key: 'estado',
            label: 'Estado',
            options: [
              ['ACTIVE', 'Activos'],
              ['INACTIVE', 'Inactivos'],
            ],
          },
          {
            key: 'wissify',
            label: 'Wissify',
            options: [
              ['LINKED', 'Vinculado'],
              ['UNLINKED', 'Sin vincular'],
            ],
          },
        ]}
        checks={[['vendidas', 'Solo con viajes vendidos']]}
        shown={rows?.length ?? null}
        total={all?.length ?? null}
      />
      {all?.length === 0 && <p className="muted">Sin clientes todavía.</p>}
      {!!all?.length && rows?.length === 0 && <p className="muted">Nada coincide con estos filtros.</p>}
      {!!rows?.length && view === 'ROWS' && (
        <div className="table-wrap card flush">
          <table className="tray" aria-label="Clientes">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Oficina</th>
                <th>Contacto principal</th>
                <th className="num">Solicitudes</th>
                <th className="num">Vendidas</th>
                <th className="num">Conversión</th>
                <th>Último viaje</th>
                <th>Wissify</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={`${s.officeId}-${s.key}`} className={s.active ? undefined : 'muted'}>
                  <th scope="row">
                    <Link href={href(s)}>{s.name}</Link>
                    <div className="wrap muted">
                      {[place(s), s.taxId].filter(Boolean).join(' · ')}
                      {!s.active && ' · inactivo'}
                    </div>
                  </th>
                  <td>{s.kind ?? 'Colegio'}</td>
                  <td>{s.officeCode}</td>
                  <td className="wrap">
                    {s.contact ? (
                      <>
                        {s.contact.name}
                        {s.contact.role && <div className="muted">{s.contact.role}</div>}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num">{s.requests}</td>
                  <td className="num">{s.won}</td>
                  <td className="num">{pct(s.conversion)}</td>
                  <td>{fmtDate(s.lastDeparture)}</td>
                  <td>
                    <WissifyBadge id={s.wissifyId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!rows?.length && view === 'CARDS' && (
        <div className="wcards compact">
          {rows.map((s) => (
            <article key={`${s.officeId}-${s.key}`} className="card wcard" aria-label={s.name}>
              <div className="eyebrow">
                {s.kind ?? 'Colegio'} · {s.officeCode}
                {place(s) && ` · ${place(s)}`}
              </div>
              <h3>
                <Link href={href(s)}>{s.name}</Link>
              </h3>
              <div className="muted">{s.contact?.name ?? 'Sin contacto'}</div>
              <div className="stagebar">
                <span>
                  {s.requests} solicitudes · {s.won} vendidas · {pct(s.conversion)}
                </span>
                <WissifyBadge id={s.wissifyId} />
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

type Tab = 'DATA' | 'CONTACTS' | 'TRIPS' | 'WISSIFY';

function DataTab({ d, onSaved }: { d: Detail; onSaved: (msg: string) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const ro = !d.canEdit;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setError(null);
    try {
      await api('/schools/client', { method: 'PUT', body: { ...f, officeId: d.officeId, key: d.key } });
      await onSaved('Datos guardados');
    } catch (err) {
      setError(errorText(err));
    }
  }
  const field = (name: keyof ClientData | 'name', label: string, max: number, wide = false) => (
    <label className={wide ? 'wide' : undefined}>
      {label}
      <input name={name} defaultValue={String(d[name] ?? '')} maxLength={max} readOnly={ro} />
    </label>
  );
  return (
    <form onSubmit={(e) => void save(e)} aria-label="Datos del cliente">
      <h3 className="ficha-sect">Identificación</h3>
      <div className="grid">
        {field('name', 'Nombre comercial', 200)}
        {field('legalName', 'Razón social', 200)}
        {field('taxId', 'RFC', 20)}
        <label>
          Tipo
          <select name="kind" defaultValue={d.kind ?? 'Colegio'} disabled={ro}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        {field('levels', 'Niveles', 150)}
        {field('website', 'Sitio web', 300)}
      </div>
      <h3 className="ficha-sect">Ubicación</h3>
      <div className="grid">
        {field('address', 'Dirección', 300, true)}
        {field('postalCode', 'C.P.', 10)}
        {field('city', 'Ciudad', 100)}
        {field('state', 'Estado', 100)}
        {field('country', 'País', 100)}
      </div>
      <h3 className="ficha-sect">Notas internas</h3>
      <textarea
        name="notes"
        aria-label="Notas internas"
        rows={2}
        maxLength={2000}
        defaultValue={d.notes ?? ''}
        readOnly={ro}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!ro && (
        <div className="row end">
          <button>Guardar cambios</button>
        </div>
      )}
    </form>
  );
}

function SchoolDetail({ officeId, schoolKey }: { officeId: string; schoolKey: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('DATA');
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
  const done = async (msg: string) => {
    await load();
    setNotice(msg);
  };

  async function addContact(c: Omit<Contact, 'id'>) {
    setError(null);
    try {
      await api('/schools/contacts', {
        method: 'POST',
        body: {
          officeId,
          key: d!.key,
          schoolName: d!.name,
          name: c.name,
          role: c.role ?? undefined,
          email: c.email ?? undefined,
          phone: c.phone ?? undefined,
        },
      });
      await done('Contacto agregado');
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  }

  async function removeContact(id: string) {
    setError(null);
    try {
      await api(`/schools/contacts/${id}`, { method: 'DELETE' });
      await done('Contacto quitado');
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function toggleActive() {
    setError(null);
    try {
      await api('/schools/client', {
        method: 'PUT',
        body: { officeId, key: d!.key, name: d!.name, active: !d!.active },
      });
      await done(d!.active ? 'Cliente desactivado' : 'Cliente activado');
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!d) return error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>;
  const won = d.trips.filter((t) => t.status === 'WON');
  const today = new Date().toISOString().slice(0, 10);
  const next = d.trips
    .filter((t) => t.status === 'WON' && t.departureDate >= today)
    .map((t) => t.departureDate)
    .sort()[0];
  return (
    <>
      <p>
        <Link href="/colegios">← Clientes</Link>
      </p>
      <section className="card">
        <div className="ficha-head">
          <div>
            <span className="pill dark">{d.kind ?? 'Colegio'}</span>{' '}
            <span className={d.active ? 'pill ok' : 'pill'}>{d.active ? '● Activo' : 'Inactivo'}</span>
            <h1>{d.name}</h1>
            <FichaStrip
              items={[
                [d.trips.length, 'solicitudes'],
                [won.length, 'vendidas'],
                [pct(d.conversion), 'conversión'],
                [won.reduce((n, t) => n + t.participants, 0), 'estudiantes en viajes vendidos'],
                [fmtDate(next ?? null), 'próximo viaje'],
              ]}
            />
          </div>
          {d.canEdit && (
            <button type="button" className="secondary" onClick={() => void toggleActive()}>
              {d.active ? 'Desactivar' : 'Activar'}
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <FichaTabs<Tab>
          label="Secciones del cliente"
          tab={tab}
          onTab={setTab}
          tabs={[
            ['DATA', 'Datos'],
            ['CONTACTS', 'Contactos', d.contacts.length],
            ['TRIPS', 'Viajes', d.trips.length],
            ['WISSIFY', 'Wissify'],
          ]}
        />
        {tab === 'DATA' && <DataTab key={d.name + d.active} d={d} onSaved={done} />}
        {tab === 'CONTACTS' && (
          <ContactsTab
            contacts={d.contacts}
            canAdd
            onAdd={addContact}
            onRemove={(id) => void removeContact(id)}
          />
        )}
        {tab === 'TRIPS' && (
          <div className="table-wrap">
            <table className="tray" aria-label="Historial de viajes">
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
                    <td className="wrap">
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
            {d.trips.length === 0 && <p className="muted">Sin solicitudes todavía.</p>}
          </div>
        )}
        {tab === 'WISSIFY' && (
          <WissifyTab
            id={d.wissifyId}
            syncedAt={d.wissifySyncedAt}
            fields={[
              ['Razón social y RFC', 'Cotizador → Wissify'],
              ['Dirección, ciudad, estado y país', 'Cotizador → Wissify'],
              ['Contactos (nombre, cargo, correo, teléfono)', 'Ambos'],
              ['Viajes vendidos (folio, salida, total)', 'Cotizador → Wissify'],
            ]}
          />
        )}
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

/** Clientes: list with filters, and each client's ficha in tabs. */
export default function Page() {
  return (
    <Suspense>
      <SchoolsPage />
    </Suspense>
  );
}
