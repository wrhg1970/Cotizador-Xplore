'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { LineCategory } from '@ee/contracts';
import { api, errorText } from '../lib/api';
import { type ConceptTemplateDto, SHEET_BLOCKS } from '../lib/types';
import { useMe } from '../lib/useMe';
import { ConfigTabs } from '../ConfigTabs';

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
  const [block, setBlock] = useState<LineCategory>(SHEET_BLOCKS[0]!.category);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
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
    if (ok) {
      form.reset();
      setAdding(false);
    }
  }

  if (me && !isSysAdmin)
    return (
      <ConfigTabs current="rubros">
        <p className="error">Solo un administrador del sistema puede editar el catálogo.</p>
      </ConfigTabs>
    );

  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (t) => t.category === block && (showInactive || t.active) && (!q || t.label.toLowerCase().includes(q)),
  );

  return (
    <ConfigTabs current="rubros">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="cfg-sub" role="group" aria-label="Bloque">
        {SHEET_BLOCKS.map((b) => (
          <button
            key={b.category}
            type="button"
            aria-pressed={block === b.category}
            onClick={() => setBlock(b.category)}
          >
            {b.title} <small>{items.filter((t) => t.category === b.category && t.active).length}</small>
          </button>
        ))}
      </div>
      <section className="card" aria-label={BLOCK[block]}>
        <div className="cfg-bar">
          <input
            type="search"
            aria-label="Buscar rubro"
            placeholder="Buscar rubro"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="inline">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />{' '}
            Mostrar inactivos
          </label>
          <span className="cfg-help">
            ⓘ Base = se agrega solo a cada escenario nuevo. Interno = nunca sale en la propuesta. Los cambios
            no tocan cotizaciones ya creadas.
          </span>

          <button type="button" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            + Nuevo rubro
          </button>
        </div>
        {adding && (
          <form onSubmit={create} className="row cfg-add" aria-label="Nuevo rubro" key={block}>
            <label>
              Nombre
              <input name="label" required maxLength={300} />
            </label>
            <label>
              Bloque
              <select name="category" defaultValue={block}>
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
            <label className="inline">
              <input name="isBase" type="checkbox" /> Base
            </label>
            <label className="inline">
              <input name="internalOnly" type="checkbox" /> Solo interno
            </label>
            <label className="inline">
              <input name="perTripDay" type="checkbox" /> Cantidad = días del viaje
            </label>
            <button>Agregar rubro</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>
              Cancelar
            </button>
          </form>
        )}
        {shown.length === 0 ? (
          <p className="muted">No hay rubros con estos filtros.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rubro</th>
                  <th className="num">Orden</th>
                  <th className="c">Base</th>
                  <th className="c">Interno</th>
                  <th className="c">Cantidad = días</th>
                  <th className="c">Activo</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} className={t.active ? undefined : 'muted'}>
                    <td>
                      <input
                        className="cfg-inline"
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
                    <td className="num">
                      <input
                        className="cfg-inline cfg-num"
                        aria-label={`Orden de ${t.label}`}
                        type="number"
                        min={0}
                        max={10000}
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
                      <td key={k} className="c">
                        <input
                          type="checkbox"
                          className="switch"
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
        )}
      </section>
    </ConfigTabs>
  );
}
