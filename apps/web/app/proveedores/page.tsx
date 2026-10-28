'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { CurrencyCode, LineCategory } from '@ee/contracts';
import { api, errorText } from '../lib/api';
import { SHEET_BLOCKS, type SupplierDto } from '../lib/types';
import { useMe } from '../lib/useMe';

const BLOCK = Object.fromEntries(SHEET_BLOCKS.map((b) => [b.category, b.title])) as Record<
  LineCategory,
  string
>;
const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim() || undefined;

/** Supplier / DMC catalog: internal costs that pre-fill quote lines. System admins maintain it. */
export default function SuppliersPage() {
  const me = useMe();
  const [items, setItems] = useState<SupplierDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isSysAdmin = !!me?.roles.some((r) => r.role === 'SYSTEM_ADMIN');

  const reload = useCallback(
    () => api<SupplierDto[]>('/suppliers').then(setItems, (e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(path: string, method: 'POST' | 'PATCH', body: object, done: string) {
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

  async function createSupplier(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = {
      name: text(f, 'name'),
      kind: text(f, 'kind'),
      country: text(f, 'country'),
      email: text(f, 'email'),
      phone: text(f, 'phone'),
    };
    if (await run('/suppliers', 'POST', body, 'Proveedor agregado')) form.reset();
  }

  async function addRate(e: FormEvent<HTMLFormElement>, supplierId: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = {
      description: text(f, 'description'),
      category: f.get('category'),
      unitCost: text(f, 'unitCost'),
      currency: f.get('currency'),
      validUntil: text(f, 'validUntil'),
    };
    if (await run(`/suppliers/${supplierId}/rates`, 'POST', body, 'Tarifa agregada')) form.reset();
  }

  return (
    <>
      <h1>Proveedores y tarifas</h1>
      <p className="muted">
        Uso interno: contiene costos. Desde el editor de cotización, cada bloque ofrece &quot;Agregar tarifa
        de proveedor…&quot;, que copia descripción, costo y moneda al concepto. Cambiar una tarifa aquí no
        modifica cotizaciones ya creadas.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {items?.length === 0 && <p className="muted">Todavía no hay proveedores.</p>}
      {items?.map((s) => (
        <section key={s.id} aria-labelledby={`s-${s.id}`} className={s.active ? undefined : 'muted'}>
          <h2 id={`s-${s.id}`}>
            {s.name}
            {!s.active && ' (inactivo)'}
          </h2>
          <p className="muted">
            {[s.kind, s.country, s.email, s.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
          </p>
          {isSysAdmin && (
            <label>
              <span>
                <input
                  type="checkbox"
                  checked={s.active}
                  onChange={(e) =>
                    void run(
                      `/suppliers/${s.id}`,
                      'PATCH',
                      { active: e.target.checked },
                      'Proveedor actualizado',
                    )
                  }
                />{' '}
                Activo
              </span>
            </label>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Bloque</th>
                  <th>Costo unitario</th>
                  <th>Moneda</th>
                  <th>Vigente hasta</th>
                  {isSysAdmin && <th>Activa</th>}
                </tr>
              </thead>
              <tbody>
                {s.rates.map((r) => (
                  <tr key={r.id} className={r.active ? undefined : 'muted'}>
                    <td>{r.description}</td>
                    <td>{BLOCK[r.category]}</td>
                    <td>
                      {isSysAdmin ? (
                        <input
                          aria-label={`Costo de ${r.description}`}
                          inputMode="decimal"
                          size={10}
                          defaultValue={r.unitCost}
                          onBlur={(e) => {
                            const unitCost = e.target.value.trim();
                            if (unitCost && unitCost !== r.unitCost)
                              void run(
                                `/supplier-rates/${r.id}`,
                                'PATCH',
                                { unitCost },
                                'Tarifa actualizada',
                              );
                          }}
                        />
                      ) : (
                        r.unitCost
                      )}
                    </td>
                    <td>{r.currency}</td>
                    <td>{r.validUntil ?? '—'}</td>
                    {isSysAdmin && (
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
                ))}
              </tbody>
            </table>
          </div>
          {isSysAdmin && (
            <form
              onSubmit={(e) => void addRate(e, s.id)}
              className="row"
              aria-label={`Nueva tarifa de ${s.name}`}
            >
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
                <input name="unitCost" required inputMode="decimal" pattern="\d+(\.\d{1,6})?" size={10} />
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
              <button>Agregar tarifa</button>
            </form>
          )}
        </section>
      ))}

      {isSysAdmin && (
        <section aria-labelledby="nuevo">
          <h2 id="nuevo">Nuevo proveedor</h2>
          <form onSubmit={(e) => void createSupplier(e)} className="row">
            <label>
              Nombre
              <input name="name" required maxLength={200} />
            </label>
            <label>
              Tipo (DMC, hotel, transporte…)
              <input name="kind" maxLength={100} />
            </label>
            <label>
              País
              <input name="country" maxLength={100} />
            </label>
            <label>
              Correo
              <input name="email" type="email" maxLength={320} />
            </label>
            <label>
              Teléfono
              <input name="phone" maxLength={50} />
            </label>
            <button>Agregar proveedor</button>
          </form>
        </section>
      )}
    </>
  );
}
