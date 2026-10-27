'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { fmtDateTime, type QuoteTemplateDto } from '../lib/types';
import { isOfficeAdmin, useMe } from '../lib/useMe';

interface Office {
  id: string;
  name: string;
}

/** Office quote templates; whoever created one, or the office coordinator, can retire it. */
export default function TemplatesPage() {
  const me = useMe();
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeId, setOfficeId] = useState('');
  const [items, setItems] = useState<QuoteTemplateDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const current = officeId || offices[0]?.id || '';

  useEffect(() => {
    api<Office[]>('/offices').then(setOffices, (e) => setError(errorText(e)));
  }, []);
  const reload = useCallback(() => {
    if (current)
      api<QuoteTemplateDto[]>(`/offices/${current}/quote-templates`).then(setItems, (e) =>
        setError(errorText(e)),
      );
  }, [current]);
  useEffect(reload, [reload]);

  async function retire(t: QuoteTemplateDto) {
    if (!window.confirm(`¿Retirar la plantilla "${t.name}"? Los escenarios ya creados no cambian.`)) return;
    setError(null);
    try {
      await api(`/quote-templates/${t.id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <h1>Plantillas de cotización</h1>
      <p className="muted">
        Se guardan desde una cotización con «Guardar como plantilla» y se eligen al crear un escenario.
        Incluyen conceptos, % de comisión, itinerario, «no incluye» y condiciones; no incluyen tipos de cambio
        ni fechas de pago.
      </p>
      {offices.length > 1 && (
        <label>
          Oficina
          <select value={current} onChange={(e) => setOfficeId(e.target.value)}>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="muted">No hay plantillas en esta oficina.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Plantilla</th>
                <th>Moneda</th>
                <th>Conceptos</th>
                <th>Creada por</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.saleCurrency}</td>
                  <td>{t.lineCount}</td>
                  <td>
                    {t.createdBy} <span className="muted">{fmtDateTime(t.createdAt)}</span>
                  </td>
                  <td>
                    {(t.createdById === me?.id || isOfficeAdmin(me, current)) && (
                      <button className="danger" onClick={() => void retire(t)}>
                        Retirar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
