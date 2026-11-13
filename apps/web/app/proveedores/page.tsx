'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { CurrencyCode, LineCategory, type QuoteVersionStatus } from '@ee/contracts';
import { amount } from '../aprobaciones/format';
import { api, errorText } from '../lib/api';
import {
  fmtDate,
  QUOTE_STATUS_LABEL,
  SHEET_BLOCKS,
  type SupplierDto,
  type SupplierRateDto,
} from '../lib/types';
import { isSystemAdmin, useMe } from '../lib/useMe';
import { matchesSearch, TrayFilters } from '../TrayFilters';
import { type Contact, ContactsTab, FichaStrip, FichaTabs, WissifyBadge, WissifyTab } from '../Ficha';

const BLOCK = Object.fromEntries(SHEET_BLOCKS.map((b) => [b.category, b.title])) as Record<
  LineCategory,
  string
>;
const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || undefined;
const KINDS = ['DMC', 'Hotel', 'Transporte', 'Aerolínea', 'Seguro', 'Actividades', 'Otro'];

type Validity = 'OK' | 'SOON' | 'OUT';
const day = (offset = 0) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
/** Vigente, por vencer (30 días) or vencida; rates without a date never expire. */
const validity = (r: SupplierRateDto): Validity =>
  !r.validUntil || r.validUntil > day(30) ? 'OK' : r.validUntil >= day() ? 'SOON' : 'OUT';
const live = (s: SupplierDto) => s.rates.filter((r) => r.active && validity(r) !== 'OUT');
const nextExpiry = (s: SupplierDto) =>
  live(s)
    .map((r) => r.validUntil)
    .filter((d): d is string => !!d)
    .sort()[0] ?? null;
const VALIDITY_CLASS: Record<Validity, string | undefined> = {
  OK: undefined,
  SOON: 'vig-soon',
  OUT: 'vig-out',
};
const options = (xs: (string | null)[]) =>
  [...new Set(xs.filter((x): x is string => !!x))].sort().map((x) => [x, x] as const);
const fichaHref = (id: string) => `/proveedores?id=${id}`;

function NewSupplier({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      const r = await api<{ id: string }>('/suppliers', {
        method: 'POST',
        body: { name: text(f, 'name'), kind: text(f, 'kind'), country: text(f, 'country') },
      });
      router.push(fichaHref(r.id));
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <section className="card" aria-label="Nuevo proveedor">
      <form onSubmit={(e) => void create(e)} className="row">
        <label>
          Nombre
          <input name="name" required maxLength={200} autoFocus />
        </label>
        <label>
          Tipo
          <select name="kind" defaultValue="DMC">
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          País
          <input name="country" maxLength={100} />
        </label>
        <button>Crear proveedor</button>
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

function SupplierList() {
  const params = useSearchParams();
  const me = useMe();
  const admin = isSystemAdmin(me);
  const [all, setAll] = useState<SupplierDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'ROWS' | 'CARDS'>('ROWS');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    api<SupplierDto[]>('/suppliers').then(setAll, (e) => setError(errorText(e)));
  }, []);
  const p = (k: string) => params.get(k) ?? '';
  const rateFilter = (s: SupplierDto) => {
    const active = s.rates.filter((r) => r.active);
    switch (p('tarifas')) {
      case 'OK':
        return live(s).length > 0;
      case 'SOON':
        return active.some((r) => validity(r) === 'SOON');
      case 'OUT':
        return active.some((r) => validity(r) === 'OUT');
      case 'NONE':
        return active.length === 0;
      default:
        return true;
    }
  };
  const rows = all?.filter(
    (s) =>
      (!p('tipo') || s.kind === p('tipo')) &&
      (!p('pais') || s.country === p('pais')) &&
      (!p('estado') || (p('estado') === 'ACTIVE') === s.active) &&
      (!p('wissify') || (p('wissify') === 'LINKED') === !!s.wissifyId) &&
      rateFilter(s) &&
      matchesSearch(p('q'), [
        s.name,
        s.legalName,
        s.taxId,
        s.country,
        s.email,
        ...s.contacts.map((c) => c.name),
      ]),
  );
  const contact = (s: SupplierDto) => {
    const c = s.contacts[0];
    return c ? { name: c.name, sub: c.email ?? c.phone } : s.email ? { name: s.email, sub: s.phone } : null;
  };

  return (
    <>
      <section className="card tray-head">
        <div>
          <h1>Proveedores</h1>
          <p className="muted">
            Uso interno: contiene costos. Las tarifas alimentan los conceptos de la hoja y Reportes › Por
            proveedor; cambiarlas no modifica cotizaciones ya creadas
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
          {admin && !adding && (
            <button type="button" onClick={() => setAdding(true)}>
              + Nuevo proveedor
            </button>
          )}
        </div>
      </section>
      {adding && <NewSupplier onCancel={() => setAdding(false)} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!all && !error && <p className="muted">Cargando…</p>}
      <TrayFilters
        placeholder="Buscar proveedor, país, RFC o contacto…"
        selects={[
          { key: 'tipo', label: 'Tipo', options: options((all ?? []).map((s) => s.kind)) },
          { key: 'pais', label: 'País', options: options((all ?? []).map((s) => s.country)) },
          {
            key: 'tarifas',
            label: 'Tarifas',
            options: [
              ['OK', 'Vigentes'],
              ['SOON', 'Por vencer (30 días)'],
              ['OUT', 'Vencidas'],
              ['NONE', 'Sin tarifas'],
            ],
          },
          ...(admin
            ? [
                {
                  key: 'estado',
                  label: 'Estado',
                  options: [
                    ['ACTIVE', 'Activos'],
                    ['INACTIVE', 'Inactivos'],
                  ] as [string, string][],
                },
              ]
            : []),
          {
            key: 'wissify',
            label: 'Wissify',
            options: [
              ['LINKED', 'Vinculado'],
              ['UNLINKED', 'Sin vincular'],
            ],
          },
        ]}
        checks={[]}
        shown={rows?.length ?? null}
        total={all?.length ?? null}
      />
      {all?.length === 0 && <p className="muted">Todavía no hay proveedores.</p>}
      {!!all?.length && rows?.length === 0 && <p className="muted">Nada coincide con estos filtros.</p>}
      {!!rows?.length && view === 'ROWS' && (
        <div className="table-wrap card flush">
          <table className="tray" aria-label="Proveedores">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Tipo</th>
                <th>País</th>
                <th>Contacto</th>
                <th className="num">Tarifas vigentes</th>
                <th>Próximo vencimiento</th>
                <th className="num">Cotizaciones 12 m</th>
                <th>Estado</th>
                <th>Wissify</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const c = contact(s);
                const next = nextExpiry(s);
                const out = s.rates.filter((r) => r.active && validity(r) === 'OUT').length;
                return (
                  <tr key={s.id} className={s.active ? undefined : 'muted'}>
                    <th scope="row">
                      <Link href={fichaHref(s.id)}>{s.name}</Link>
                      {s.taxId && <div className="muted">{s.taxId}</div>}
                    </th>
                    <td>{s.kind ?? '—'}</td>
                    <td>{s.country ?? '—'}</td>
                    <td className="wrap">
                      {c ? (
                        <>
                          {c.name}
                          {c.sub && <div className="muted">{c.sub}</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{live(s).length}</td>
                    <td className="wrap">
                      {next ? (
                        <span className={next <= day(30) ? 'vig-soon' : undefined}>{fmtDate(next)}</span>
                      ) : (
                        '—'
                      )}
                      {out > 0 && <div className="vig-out">{out} vencida(s)</div>}
                    </td>
                    <td className="num">{s.quotes12m}</td>
                    <td>{s.active ? 'Activo' : 'Inactivo'}</td>
                    <td>
                      <WissifyBadge id={s.wissifyId} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!!rows?.length && view === 'CARDS' && (
        <div className="wcards compact">
          {rows.map((s) => (
            <article key={s.id} className="card wcard" aria-label={s.name}>
              <div className="eyebrow">{[s.kind, s.country].filter(Boolean).join(' · ') || 'Proveedor'}</div>
              <h3>
                <Link href={fichaHref(s.id)}>{s.name}</Link>
              </h3>
              <div className="muted">{contact(s)?.name ?? 'Sin contacto'}</div>
              <div className="stagebar">
                <span>
                  {live(s).length} tarifas vigentes · {s.quotes12m} cotizaciones 12 m
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

type Tab = 'DATA' | 'CONTACTS' | 'RATES' | 'USAGE' | 'WISSIFY';

interface Usage {
  id: string;
  description: string;
  unitCost: string;
  currency: string;
  versionId: string;
  version: number;
  status: QuoteVersionStatus;
  scenario: string;
  date: string;
  request: { id: string; folio: string; groupName: string; clientName: string | null };
}

function DataTab({
  s,
  admin,
  run,
}: {
  s: SupplierDto;
  admin: boolean;
  run: (path: string, method: 'POST' | 'PATCH', body: object, done: string) => Promise<boolean>;
}) {
  const ro = !admin;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    await run(`/suppliers/${s.id}`, 'PATCH', body, 'Datos guardados');
  }
  const field = (name: keyof SupplierDto, label: string, max: number, type = 'text') => (
    <label>
      {label}
      <input name={name} type={type} defaultValue={String(s[name] ?? '')} maxLength={max} readOnly={ro} />
    </label>
  );
  return (
    <form onSubmit={(e) => void save(e)} aria-label="Datos del proveedor">
      <h3 className="ficha-sect">Identificación</h3>
      <div className="grid">
        {field('name', 'Nombre comercial', 200)}
        {field('legalName', 'Razón social', 200)}
        {field('taxId', 'RFC / Tax ID', 20)}
        <label>
          Tipo
          <select name="kind" defaultValue={s.kind ?? ''} disabled={ro}>
            <option value="">—</option>
            {[...new Set([...KINDS, ...(s.kind ? [s.kind] : [])])].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        {field('country', 'País', 100)}
        {field('website', 'Sitio web', 300)}
      </div>
      <h3 className="ficha-sect">Contacto general</h3>
      <div className="grid">
        {field('email', 'Correo', 320, 'email')}
        {field('phone', 'Teléfono', 50)}
      </div>
      <h3 className="ficha-sect">Notas internas</h3>
      <textarea
        name="notes"
        aria-label="Notas internas"
        rows={2}
        maxLength={2000}
        defaultValue={s.notes ?? ''}
        readOnly={ro}
      />
      {admin && (
        <div className="row end">
          <button>Guardar cambios</button>
        </div>
      )}
    </form>
  );
}

function RatesTab({
  s,
  admin,
  run,
}: {
  s: SupplierDto;
  admin: boolean;
  run: (path: string, method: 'POST' | 'PATCH', body: object, done: string) => Promise<boolean>;
}) {
  const [block, setBlock] = useState('');
  const [vig, setVig] = useState<'' | 'LIVE' | 'OUT'>('LIVE');
  const rates = s.rates.filter(
    (r) =>
      (!block || r.category === block) && (!vig || (vig === 'OUT') === (validity(r) === 'OUT' || !r.active)),
  );
  async function addRate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = {
      description: text(f, 'description'),
      category: f.get('category'),
      unitCost: text(f, 'unitCost'),
      currency: f.get('currency'),
      validUntil: text(f, 'validUntil'),
      notes: text(f, 'notes'),
    };
    if (await run(`/suppliers/${s.id}/rates`, 'POST', body, 'Tarifa agregada')) form.reset();
  }
  return (
    <>
      <div className="row">
        <label>
          Bloque
          <select value={block} onChange={(e) => setBlock(e.target.value)}>
            <option value="">Todos</option>
            {LineCategory.options.map((c) => (
              <option key={c} value={c}>
                {BLOCK[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vigencia
          <select value={vig} onChange={(e) => setVig(e.target.value as typeof vig)}>
            <option value="LIVE">Vigentes y por vencer</option>
            <option value="OUT">Vencidas o inactivas</option>
            <option value="">Todas</option>
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table className="tray" aria-label="Tarifas">
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Bloque</th>
              <th className="num">Costo unitario</th>
              <th>Moneda</th>
              <th>Vigente hasta</th>
              <th>Notas</th>
              {admin && <th>Activa</th>}
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => {
              const v = validity(r);
              return (
                <tr key={r.id} className={r.active ? undefined : 'muted'}>
                  <td className="wrap">{r.description}</td>
                  <td>{BLOCK[r.category]}</td>
                  <td className="num">
                    {admin ? (
                      <input
                        aria-label={`Costo de ${r.description}`}
                        inputMode="decimal"
                        size={9}
                        defaultValue={r.unitCost}
                        onBlur={(e) => {
                          const unitCost = e.target.value.trim();
                          if (unitCost && unitCost !== r.unitCost)
                            void run(`/supplier-rates/${r.id}`, 'PATCH', { unitCost }, 'Tarifa actualizada');
                        }}
                      />
                    ) : (
                      r.unitCost
                    )}
                  </td>
                  <td>{r.currency}</td>
                  <td className={VALIDITY_CLASS[v]}>
                    {r.validUntil ? fmtDate(r.validUntil) : 'Sin fecha'}
                    {v === 'SOON' && ' · por vencer'}
                    {v === 'OUT' && ' · vencida'}
                  </td>
                  <td className="wrap muted">{r.notes ?? ''}</td>
                  {admin && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Activa: ${r.description}`}
                        checked={r.active}
                        onChange={(e) =>
                          void run(
                            `/supplier-rates/${r.id}`,
                            'PATCH',
                            { active: e.target.checked },
                            'Tarifa actualizada',
                          )
                        }
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rates.length === 0 && <p className="muted">Sin tarifas con estos filtros.</p>}
      </div>
      {admin && (
        <form onSubmit={(e) => void addRate(e)} className="row" aria-label={`Nueva tarifa de ${s.name}`}>
          <label>
            Concepto
            <input name="description" required maxLength={300} />
          </label>
          <label>
            Bloque
            <select name="category" defaultValue="PER_PARTICIPANT">
              {LineCategory.options.map((c) => (
                <option key={c} value={c}>
                  {BLOCK[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Costo unitario
            <input name="unitCost" required inputMode="decimal" pattern="\d+(\.\d{1,6})?" size={9} />
          </label>
          <label>
            Moneda
            <select name="currency" defaultValue="MXN">
              {CurrencyCode.options.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Vigente hasta
            <input name="validUntil" type="date" />
          </label>
          <label>
            Notas
            <input name="notes" maxLength={1000} />
          </label>
          <button>Agregar tarifa</button>
        </form>
      )}
    </>
  );
}

function UsageTab({ id }: { id: string }) {
  const [rows, setRows] = useState<Usage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Usage[]>(`/suppliers/${id}/usage`).then(setRows, (e) => setError(errorText(e)));
  }, [id]);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!rows) return <p className="muted">Cargando…</p>;
  if (!rows.length) return <p className="muted">Ninguna cotización de tus oficinas usa este proveedor.</p>;
  return (
    <div className="table-wrap">
      <table className="tray" aria-label="Uso en cotizaciones">
        <thead>
          <tr>
            <th>Folio / Grupo</th>
            <th>Escenario</th>
            <th>Estado</th>
            <th>Concepto</th>
            <th className="num">Costo unitario</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <th scope="row">
                <Link href={`/solicitudes/${u.request.id}`}>{u.request.folio}</Link>
                <div className="wrap muted">
                  {u.request.clientName ? `${u.request.clientName} — ` : ''}
                  {u.request.groupName}
                </div>
              </th>
              <td>
                <Link href={`/cotizaciones/${u.versionId}`}>
                  {u.scenario} · v{u.version}
                </Link>
              </td>
              <td>{QUOTE_STATUS_LABEL[u.status]}</td>
              <td className="wrap">{u.description}</td>
              <td className="num">{amount(u.unitCost, u.currency)}</td>
              <td>{fmtDate(u.date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 200 && <p className="muted">Se muestran las 200 más recientes.</p>}
    </div>
  );
}

function SupplierDetail({ id }: { id: string }) {
  const me = useMe();
  const admin = isSystemAdmin(me);
  const [s, setS] = useState<SupplierDto | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('DATA');
  // shortcut: reads the whole catalog to show one supplier; fine for a few hundred, add GET /suppliers/:id beyond that.
  const reload = useCallback(
    () =>
      api<SupplierDto[]>('/suppliers').then(
        (all) => setS(all.find((x) => x.id === id) ?? null),
        (e) => setError(errorText(e)),
      ),
    [id],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: object | undefined,
    done: string,
  ) {
    setError(null);
    setNotice(null);
    try {
      await api(path, { method, body });
      await reload();
      setNotice(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }
  const addContact = (c: Omit<Contact, 'id'>) =>
    run(
      `/suppliers/${id}/contacts`,
      'POST',
      Object.fromEntries(Object.entries(c).filter(([, v]) => v)),
      'Contacto agregado',
    );

  if (s === undefined) return error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>;
  if (s === null)
    return (
      <>
        <p>
          <Link href="/proveedores">← Proveedores</Link>
        </p>
        <p className="error">Proveedor no encontrado.</p>
      </>
    );
  const soon = s.rates.filter((r) => r.active && validity(r) === 'SOON').length;
  return (
    <>
      <p>
        <Link href="/proveedores">← Proveedores</Link>
      </p>
      <section className="card">
        <div className="ficha-head">
          <div>
            {s.kind && <span className="pill dark">{s.kind}</span>}{' '}
            {s.country && <span className="pill">{s.country}</span>}{' '}
            <span className={s.active ? 'pill ok' : 'pill'}>{s.active ? '● Activo' : 'Inactivo'}</span>
            <h1>{s.name}</h1>
            <FichaStrip
              items={[
                [live(s).length, 'tarifas vigentes'],
                [<span className={soon ? 'vig-soon' : undefined}>{soon}</span>, 'vencen en 30 días'],
                [s.quotes12m, 'cotizaciones 12 m'],
                [s.contacts.length, 'contactos'],
              ]}
            />
          </div>
          {admin && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void run(
                  `/suppliers/${s.id}`,
                  'PATCH',
                  { active: !s.active },
                  s.active ? 'Proveedor desactivado' : 'Proveedor activado',
                )
              }
            >
              {s.active ? 'Desactivar' : 'Activar'}
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
          label="Secciones del proveedor"
          tab={tab}
          onTab={setTab}
          tabs={[
            ['DATA', 'Datos'],
            ['CONTACTS', 'Contactos', s.contacts.length],
            ['RATES', 'Tarifas', s.rates.length],
            ['USAGE', 'Uso en cotizaciones', s.quotes12m],
            ['WISSIFY', 'Wissify'],
          ]}
        />
        {tab === 'DATA' && <DataTab key={s.name + s.active} s={s} admin={admin} run={run} />}
        {tab === 'CONTACTS' && (
          <ContactsTab
            contacts={s.contacts}
            canAdd={admin}
            onAdd={addContact}
            onRemove={
              admin
                ? (cid) => void run(`/supplier-contacts/${cid}`, 'DELETE', undefined, 'Contacto quitado')
                : undefined
            }
          />
        )}
        {tab === 'RATES' && <RatesTab s={s} admin={admin} run={run} />}
        {tab === 'USAGE' && <UsageTab id={s.id} />}
        {tab === 'WISSIFY' && (
          <WissifyTab
            id={s.wissifyId}
            syncedAt={s.wissifySyncedAt}
            fields={[
              ['Razón social, RFC y país', 'Cotizador → Wissify'],
              ['Contactos (nombre, cargo, correo, teléfono)', 'Ambos'],
              ['Tarifas vigentes (concepto, costo, moneda, vigencia)', 'Por definir con Wissify'],
              ['Costos de viajes vendidos', 'Cotizador → Wissify'],
            ]}
          />
        )}
      </section>
    </>
  );
}

function SuppliersPage() {
  const id = useSearchParams().get('id');
  return id ? <SupplierDetail id={id} /> : <SupplierList />;
}

/** Supplier / DMC catalog: list with filters and each supplier's ficha in tabs. Internal: contains costs. */
export default function Page() {
  return (
    <Suspense>
      <SuppliersPage />
    </Suspense>
  );
}
