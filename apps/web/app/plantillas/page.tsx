'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { ConfigTabs } from '../ConfigTabs';
import { api, errorText } from '../lib/api';
import { fmtDateTime, type QuoteLineDto, type QuoteTemplateDto, SHEET_BLOCKS } from '../lib/types';
import { isOfficeAdmin, useMe } from '../lib/useMe';

interface Office {
  id: string;
  name: string;
}
const BLOCK = Object.fromEntries(SHEET_BLOCKS.map((b) => [b.category, b.title]));

/** Office quote templates; whoever created one, or the office coordinator, can retire it. */
export default function TemplatesPage() {
  const me = useMe();
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeId, setOfficeId] = useState('');
  const [items, setItems] = useState<QuoteTemplateDto[]>([]);
  const [query, setQuery] = useState('');
  const [currency, setCurrency] = useState('');
  const [open, setOpen] = useState<{ id: string; lines: QuoteLineDto[] } | null>(null);
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

  async function toggle(t: QuoteTemplateDto) {
    if (open?.id === t.id) return setOpen(null);
    try {
      const full = await api<{ lines: QuoteLineDto[] }>(`/quote-templates/${t.id}`);
      setOpen({ id: t.id, lines: full.lines });
    } catch (e) {
      setError(errorText(e));
    }
  }

  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (t) => (!q || t.name.toLowerCase().includes(q)) && (!currency || t.saleCurrency === currency),
  );

  return (
    <ConfigTabs current="plantillas">
      <section className="card" aria-label="Plantillas de la oficina">
        <div className="cfg-bar">
          {offices.length > 1 && (
            <select aria-label="Oficina" value={current} onChange={(e) => setOfficeId(e.target.value)}>
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <input
            type="search"
            aria-label="Buscar plantilla"
            placeholder="Buscar plantilla o destino"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="Moneda" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="">Moneda: todas</option>
            {[...new Set(items.map((t) => t.saleCurrency))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="cfg-help">ⓘ Se crean desde una cotización con «Guardar como plantilla».</span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {shown.length === 0 ? (
          <p className="muted">
            {items.length ? 'Ninguna plantilla con estos filtros.' : 'No hay plantillas en esta oficina.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plantilla</th>
                  <th>Moneda</th>
                  <th className="num">Conceptos</th>
                  <th className="num">Comisión</th>
                  <th>Creada por</th>
                  <th>Fecha</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <Fragment key={t.id}>
                    <tr>
                      <td>
                        <strong>{t.name}</strong>
                      </td>
                      <td>{t.saleCurrency}</td>
                      <td className="num">{t.lineCount}</td>
                      <td className="num">{Number((Number(t.targetMarginRate) * 100).toFixed(2))}%</td>
                      <td>{t.createdBy}</td>
                      <td className="muted">{fmtDateTime(t.createdAt)}</td>
                      <td className="cfg-acts">
                        <button
                          className="link"
                          aria-expanded={open?.id === t.id}
                          onClick={() => void toggle(t)}
                        >
                          Ver
                        </button>
                        {(t.createdById === me?.id || isOfficeAdmin(me, current)) && (
                          <button className="link danger" onClick={() => void retire(t)}>
                            Retirar
                          </button>
                        )}
                      </td>
                    </tr>
                    {open?.id === t.id && (
                      <tr>
                        <td colSpan={7} className="cfg-detail">
                          <ul aria-label={`Conceptos de ${t.name}`}>
                            {open.lines.map((l, i) => (
                              <li key={i}>
                                <span className="muted">{BLOCK[l.category]} · </span>
                                {l.description}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </ConfigTabs>
  );
}
