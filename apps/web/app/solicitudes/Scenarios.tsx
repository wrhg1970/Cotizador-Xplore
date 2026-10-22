'use client';

import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { CurrencyCode } from '@ee/contracts';
import { api, errorText } from '../lib/api';
import { QUOTE_STATUS_LABEL, type ScenarioDto } from '../lib/types';

/** US-029/030/047: scenarios side by side, with create and duplicate for whoever quotes. */
export function Scenarios({ requestId, canWork }: { requestId: string; canWork: boolean }) {
  const [items, setItems] = useState<ScenarioDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      api<ScenarioDto[]>(`/requests/${requestId}/scenarios`).then(setItems, (e) => setError(errorText(e))),
    [requestId],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(path: string, body: object) {
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void run(`/requests/${requestId}/scenarios`, {
      name: String(f.get('name')).trim(),
      saleCurrency: f.get('saleCurrency'),
    }).then(() => form.reset());
  }

  return (
    <section aria-labelledby="escenarios">
      <h2 id="escenarios">Escenarios</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items?.length === 0 && <p className="muted">Aún no hay escenarios.</p>}
      {!!items?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Escenario</th>
                <th>Versión</th>
                <th>Grupo</th>
                <th>Coste / estudiante</th>
                <th>Precio / estudiante</th>
                <th>Margen del grupo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const v = s.latest;
                const t = v.totals;
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/cotizaciones/${v.id}`}>{s.name}</Link>
                    </td>
                    <td>
                      v{v.number} · {QUOTE_STATUS_LABEL[v.status]}
                    </td>
                    <td>
                      {v.participants} est. · {v.chaperones} chap. · {v.staff} EE
                    </td>
                    <td>{t ? `${t.costPerParticipant} ${v.saleCurrency}` : '—'}</td>
                    <td>
                      <strong>{t ? `${t.pricePerParticipant} ${v.saleCurrency}` : '—'}</strong>
                    </td>
                    <td>{t ? `${t.groupMargin} ${v.saleCurrency}` : (v.warnings[0]?.message ?? '—')}</td>
                    <td>
                      {canWork && (
                        <button
                          className="secondary"
                          onClick={() => {
                            const name = window
                              .prompt('Nombre del nuevo escenario:', `${s.name} (copia)`)
                              ?.trim();
                            if (name) void run(`/scenarios/${s.id}/duplicate`, { name });
                          }}
                        >
                          Duplicar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canWork && (
        <form onSubmit={create} className="row" style={{ marginTop: 8 }}>
          <label>
            Nombre del escenario
            <input name="name" required maxLength={150} placeholder="Opción 1" />
          </label>
          <label>
            Moneda de venta
            <select name="saleCurrency" defaultValue="EUR">
              {CurrencyCode.options.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <button>Nuevo escenario</button>
        </form>
      )}
    </section>
  );
}
