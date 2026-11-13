'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import type { ProposalItemDto } from '../lib/types';
import { isSystemAdmin, useMe } from '../lib/useMe';
import { ConfigTabs } from '../ConfigTabs';

const SIDES = [
  [false, 'Incluye'],
  [true, 'No incluye'],
] as const;

/** Catalog of Incluye / No incluye phrases picked with one click in the proposal; system admins maintain it. */
export default function ProposalItemsPage() {
  const me = useMe();
  const [items, setItems] = useState<ProposalItemDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [excluded, setExcluded] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const reload = useCallback(
    () => api<ProposalItemDto[]>('/proposal-items').then(setItems, (e) => setError(errorText(e))),
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
      '/proposal-items',
      'POST',
      { label: String(f.get('label')).trim(), excluded, isDefault: f.get('isDefault') === 'on' },
      'Concepto agregado',
    );
    if (ok) form.reset();
  }

  if (me && !isSystemAdmin(me))
    return (
      <ConfigTabs current="incluye">
        <p className="error">Solo un administrador del sistema puede editar el catálogo.</p>
      </ConfigTabs>
    );

  const shown = items.filter((t) => t.excluded === excluded && (showInactive || t.active));
  const side = excluded ? 'No incluye' : 'Incluye';

  return (
    <ConfigTabs current="incluye">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="cfg-sub" role="group" aria-label="Lista">
        {SIDES.map(([x, label]) => (
          <button key={label} type="button" aria-pressed={excluded === x} onClick={() => setExcluded(x)}>
            {label} <small>{items.filter((t) => t.excluded === x && t.active).length}</small>
          </button>
        ))}
      </div>
      <section className="card" aria-label={side}>
        <form onSubmit={create} className="cfg-bar" aria-label={`Nuevo concepto: ${side}`} key={side}>
          <input
            name="label"
            required
            maxLength={300}
            aria-label="Concepto"
            placeholder={`Nuevo concepto de ${side}`}
          />
          <label className="inline">
            <input name="isDefault" type="checkbox" /> Siempre marcado
          </label>
          <button>Agregar</button>
          <label className="inline">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />{' '}
            Mostrar retirados
          </label>
          <span className="cfg-help">
            ⓘ Se eligen con un clic en Cotización → Propuesta. Siempre marcado = ya viene elegido en cada
            escenario nuevo sin plantilla. Los cambios no tocan propuestas ya creadas.
          </span>
        </form>
        {shown.length === 0 ? (
          <p className="muted">No hay conceptos en esta lista.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th className="num">Orden</th>
                  <th className="c">Siempre marcado</th>
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
                            void run(`/proposal-items/${t.id}`, 'PATCH', { label }, 'Concepto actualizado');
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
                              `/proposal-items/${t.id}`,
                              'PATCH',
                              { position },
                              'Concepto actualizado',
                            );
                        }}
                      />
                    </td>
                    {(['isDefault', 'active'] as const).map((k) => (
                      <td key={k} className="c">
                        <input
                          type="checkbox"
                          className="switch"
                          aria-label={`${k === 'active' ? 'Activo' : 'Siempre marcado'}: ${t.label}`}
                          checked={t[k]}
                          onChange={(e) =>
                            void run(
                              `/proposal-items/${t.id}`,
                              'PATCH',
                              { [k]: e.target.checked },
                              'Concepto actualizado',
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
