'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { LineCategory } from '@ee/contracts';
import { api, errorText } from '../lib/api';
import { type ConceptTemplateDto, SHEET_BLOCKS } from '../lib/types';
import { useMe } from '../lib/useMe';

const FLAG = {
  isBase: 'Base',
  internalOnly: 'Interno',
  perTripDay: 'Días del viaje',
  active: 'Activo',
} as const;
const BLOCK = Object.fromEntries(SHEET_BLOCKS.map((b) => [b.category, b.title])) as Record<
  LineCategory,
  string
>;

/** Catalog of EE sheet concepts ("rubros"); system admins add, rename and retire them. */
export default function ConceptsPage() {
  const me = useMe();
  const [items, setItems] = useState<ConceptTemplateDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isSysAdmin = !!me?.roles.some((r) => r.role === 'SYSTEM_ADMIN');

  const reload = useCallback(
    () => api<ConceptTemplateDto[]>('/concept-templates').then(setItems, (e) => setError(errorText(e))),
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

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await run(
      '/concept-templates',
      'POST',
      {
        label: String(f.get('label')).trim(),
        category: f.get('category'),
        internalOnly: f.get('internalOnly') === 'on',
        isBase: f.get('isBase') === 'on',
        perTripDay: f.get('perTripDay') === 'on',
        position: Number(f.get('position') || 0),
      },
      'Rubro agregado',
    );
    if (ok) form.reset();
  }

  if (me && !isSysAdmin)
    return <p className="error">Solo un administrador del sistema puede editar el catálogo.</p>;

  return (
    <>
      <h1>Catálogo de rubros</h1>
      <p className="muted">
        Los rubros base se agregan solos a cada escenario nuevo, con costo cero. Los demás se eligen desde el
        editor. Los internos nunca aparecen en la propuesta al cliente. Un cambio aquí no modifica
        cotizaciones ya creadas.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {SHEET_BLOCKS.map((b) => (
        <section key={b.category} aria-labelledby={`b-${b.category}`}>
          <h2 id={`b-${b.category}`}>{b.title}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rubro</th>
                  <th>Orden</th>
                  <th>Base</th>
                  <th>Interno</th>
                  <th>Cantidad = días del viaje</th>
                  <th>Activo</th>
                </tr>
              </thead>
              <tbody>
                {items
                  .filter((t) => t.category === b.category)
                  .map((t) => (
                    <tr key={t.id} className={t.active ? undefined : 'muted'}>
                      <td>
                        <input
                          aria-label={`Nombre de ${t.label}`}
                          defaultValue={t.label}
                          maxLength={300}
                          onBlur={(e) => {
                            const label = e.target.value.trim();
                            if (label && label !== t.label)
                              void run(`/concept-templates/${t.id}`, 'PATCH', { label }, 'Rubro actualizado');
                          }}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Orden de ${t.label}`}
                          type="number"
                          min={0}
                          max={10000}
                          size={5}
                          defaultValue={t.position}
                          onBlur={(e) => {
                            const position = Number(e.target.value);
                            if (position !== t.position)
                              void run(
                                `/concept-templates/${t.id}`,
                                'PATCH',
                                { position },
                                'Rubro actualizado',
                              );
                          }}
                        />
                      </td>
                      {(Object.keys(FLAG) as (keyof typeof FLAG)[]).map((k) => (
                        <td key={k}>
                          <input
                            type="checkbox"
                            aria-label={`${FLAG[k]}: ${t.label}`}
                            checked={t[k]}
                            onChange={(e) =>
                              void run(
                                `/concept-templates/${t.id}`,
                                'PATCH',
                                { [k]: e.target.checked },
                                'Rubro actualizado',
                              )
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section aria-labelledby="nuevo">
        <h2 id="nuevo">Nuevo rubro</h2>
        <form onSubmit={create} className="row">
          <label>
            Nombre
            <input name="label" required maxLength={300} />
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
            Orden
            <input name="position" type="number" min={0} max={10000} defaultValue={0} />
          </label>
          <label>
            <span>
              <input name="isBase" type="checkbox" /> Base (en cada escenario nuevo)
            </span>
          </label>
          <label>
            <span>
              <input name="internalOnly" type="checkbox" /> Solo interno
            </span>
          </label>
          <label>
            <span>
              <input name="perTripDay" type="checkbox" /> Cantidad = días del viaje
            </span>
          </label>
          <button>Agregar rubro</button>
        </form>
      </section>
    </>
  );
}
