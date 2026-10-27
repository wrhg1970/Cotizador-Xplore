'use client';

import Link from 'next/link';
import { type FormEvent, Fragment, type ReactNode, useCallback, useEffect, useState } from 'react';
import { CurrencyCode } from '@ee/contracts';
import { api, errorText } from '../lib/api';
import {
  isAuthorized,
  PENDING_LEGEND,
  QUOTE_STATUS_LABEL,
  type QuoteDto,
  type QuoteTemplateDto,
  type ScenarioDto,
  SHEET_BLOCKS,
} from '../lib/types';

/** US-029/030/047: scenarios side by side, with create and duplicate for whoever quotes. */
export function Scenarios({
  requestId,
  officeId,
  canWork,
}: {
  requestId: string;
  officeId: string;
  canWork: boolean;
}) {
  const [items, setItems] = useState<ScenarioDto[] | null>(null);
  const [templates, setTemplates] = useState<QuoteTemplateDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      api<ScenarioDto[]>(`/requests/${requestId}/scenarios`).then(setItems, (e) => setError(errorText(e))),
    [requestId],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (canWork)
      api<QuoteTemplateDto[]>(`/offices/${officeId}/quote-templates`).then(setTemplates, () =>
        setTemplates([]),
      );
  }, [canWork, officeId]);

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
      ...(f.get('templateId') ? { templateId: f.get('templateId') } : {}),
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
      {!!items?.length && <Comparison items={items} canWork={canWork} run={run} />}
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
          {templates.length > 0 && (
            <label>
              Empezar desde
              <select
                name="templateId"
                defaultValue=""
                onChange={(e) => {
                  const t = templates.find((x) => x.id === e.target.value);
                  const cur = e.currentTarget.form?.elements.namedItem('saleCurrency');
                  if (t && cur instanceof HTMLSelectElement) cur.value = t.saleCurrency;
                }}
              >
                <option value="">Rubros base del catálogo</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    Plantilla: {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button>Nuevo escenario</button>
        </form>
      )}
    </section>
  );
}

const pct = (rate: string) => `${Number((Number(rate) * 100).toFixed(2))}%`;

/** Total of one concept in a version (sale currency, headcount applied); same-named lines add up. */
function conceptTotal(v: QuoteDto, category: string, description: string) {
  if (!v.totals) return '—';
  const hits = v.lines.flatMap((l, i) =>
    l.category === category && l.description === description ? [Number(v.totals!.lineTotals[i])] : [],
  );
  return hits.length ? hits.reduce((a, b) => a + b, 0).toFixed(2) : '—';
}

/** Opción 1, 2, 3… as columns with the EE sheet's rows aligned across them. */
function Comparison({
  items,
  canWork,
  run,
}: {
  items: ScenarioDto[];
  canWork: boolean;
  run: (path: string, body: object) => Promise<void>;
}) {
  const row = (label: string, cell: (v: QuoteDto) => ReactNode, strong = false) => (
    <tr className={strong ? 'total strong' : undefined}>
      <th scope="row">{label}</th>
      {items.map((s) => (
        <td key={s.id} className="num">
          {cell(s.latest)}
        </td>
      ))}
    </tr>
  );
  const money = (pick: (v: QuoteDto) => string | null | undefined) => (v: QuoteDto) => {
    const x = pick(v);
    return x ? `${x} ${v.saleCurrency}` : '—';
  };
  const concepts = SHEET_BLOCKS.map((b) => ({
    ...b,
    names: [
      ...new Set(
        items.flatMap((s) =>
          s.latest.lines.filter((l) => l.category === b.category).map((l) => l.description),
        ),
      ),
    ],
  }));

  return (
    <div className="table-wrap">
      <table className="compare">
        <thead>
          <tr>
            <th />
            {items.map((s) => (
              <th key={s.id} scope="col" className="num">
                <Link href={`/cotizaciones/${s.latest.id}`}>{s.name}</Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row('Versión', (v) => (
            <>
              v{v.number} · {QUOTE_STATUS_LABEL[v.status]}
              {!isAuthorized(v.status) && <div className="error">{PENDING_LEGEND}</div>}
            </>
          ))}
          {row('Grupo', (v) => `${v.participants} est. · ${v.chaperones} chap. · ${v.staff} EE`)}
          {concepts.map((b) =>
            b.names.length ? (
              <Fragment key={b.category}>
                <tr>
                  <th colSpan={items.length + 1}>{b.title}</th>
                </tr>
                {b.names.map((n) => (
                  <Fragment key={n}>{row(n, (v) => conceptTotal(v, b.category, n))}</Fragment>
                ))}
              </Fragment>
            ) : null,
          )}
          <tr>
            <th colSpan={items.length + 1}>Resumen</th>
          </tr>
          {row(
            'SubTotal 1',
            money((v) => v.totals?.directPerParticipant),
          )}
          {row(
            'Gastos del líder',
            money((v) => v.sheet?.leaderPerParticipant),
          )}
          {row(
            'Fijos del grupo ÷ estudiantes',
            money((v) => v.sheet?.groupFixedPerParticipant),
          )}
          {row(
            'SubTotal 2 (coste / estudiante)',
            money((v) => v.totals?.costPerParticipant),
          )}
          {row('% Comisión', (v) => pct(v.targetMarginRate))}
          {row(
            'Comisión / estudiante',
            money((v) => v.totals?.marginPerParticipant),
          )}
          {row(
            'Precio / estudiante',
            money((v) => v.totals?.pricePerParticipant),
            true,
          )}
          {row('Estimado en pesos', (v) =>
            v.totals?.pricePerParticipantMxn ? `${v.totals.pricePerParticipantMxn} MXN` : '—',
          )}
          {row(
            'Total chaperones',
            money((v) => v.sheet?.totalChaperones),
          )}
          {row('Margen del grupo', (v) =>
            v.totals ? `${v.totals.groupMargin} ${v.saleCurrency}` : (v.warnings[0]?.message ?? '—'),
          )}
          {canWork && (
            <tr>
              <th />
              {items.map((s) => (
                <td key={s.id} className="num">
                  <button
                    className="secondary"
                    onClick={() => {
                      const name = window.prompt('Nombre del nuevo escenario:', `${s.name} (copia)`)?.trim();
                      if (name) void run(`/scenarios/${s.id}/duplicate`, { name });
                    }}
                  >
                    Duplicar
                  </button>
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
