'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, Fragment, useCallback, useEffect, useState } from 'react';
import { CurrencyCode } from '@ee/contracts';
import { api, errorText } from '../lib/api';
import {
  isPicked,
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
  wonVersionId,
}: {
  requestId: string;
  officeId: string;
  canWork: boolean;
  wonVersionId?: string | null;
}) {
  const [items, setItems] = useState<ScenarioDto[] | null>(null);
  const [templates, setTemplates] = useState<QuoteTemplateDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

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

  async function duplicate(id: string, name: string) {
    setError(null);
    try {
      const s = await api<ScenarioDto>(`/scenarios/${id}/duplicate`, { method: 'POST', body: { name } });
      router.push(`/cotizaciones/${s.latest.id}`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    try {
      const s = await api<ScenarioDto>(`/requests/${requestId}/scenarios`, {
        method: 'POST',
        body: {
          name: String(f.get('name')).trim(),
          saleCurrency: f.get('saleCurrency'),
          ...(f.get('templateId') ? { templateId: f.get('templateId') } : {}),
        },
      });
      // Every new scenario opens its EE sheet so quoting starts right away (Will, 2026-10-29).
      router.push(`/cotizaciones/${s.latest.id}`);
    } catch (err) {
      setError(errorText(err));
    }
  }

  const picked = items?.find(isPicked);

  return (
    <section aria-labelledby="escenarios">
      <h2 id="escenarios" style={{ marginTop: 0 }}>
        Escenarios{items ? ` (${items.length})` : ''}
      </h2>
      {/* Above the comparison so a new option never means scrolling past every concept (Will, 2026-11-06). */}
      {canWork && (
        <form onSubmit={(e) => void create(e)} className="row scenario-new" aria-label="Nuevo escenario">
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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {picked && (
        <p className="picked-note" role="status">
          ✓ Escenario aprobado: <strong>{picked.name}</strong>. Solo puede haber uno por solicitud; los demás
          no se pueden aprobar mientras siga aprobado.
        </p>
      )}
      {items?.length === 0 && <p className="muted">Aún no hay escenarios.</p>}
      {!!items?.length && (
        <Comparison
          items={items}
          pickedId={picked?.id}
          wonVersionId={wonVersionId}
          canWork={canWork}
          duplicate={duplicate}
        />
      )}
    </section>
  );
}

const n2 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const fmt = (x: number | null) => (x === null ? '—' : n2.format(x));
const num = (x: string | null | undefined) => (x === null || x === undefined || x === '' ? null : Number(x));

/** Total of one concept in a version (sale currency, headcount applied); same-named lines add up. */
export function conceptTotal(v: QuoteDto, category: string, description: string): number | null {
  if (!v.totals) return null;
  const hits = v.lines.flatMap((l, i) =>
    l.category === category && l.description === description ? [Number(v.totals!.lineTotals[i])] : [],
  );
  return hits.length ? hits.reduce((a, b) => a + b, 0) : null;
}

/** Difference against the reference column, or null when there is nothing to flag. */
export function delta(x: number | null, ref: number | null): number | null {
  const d = (x ?? 0) - (ref ?? 0);
  return Math.abs(d) < 0.005 ? null : d;
}

type Row = {
  label: string;
  get: (v: QuoteDto) => number | null;
  suffix?: (v: QuoteDto) => string;
  strong?: boolean;
};

const SUMMARY: Row[] = [
  { label: 'SubTotal 1', get: (v) => num(v.totals?.directPerParticipant) },
  { label: 'Gastos del líder', get: (v) => num(v.sheet?.leaderPerParticipant) },
  { label: 'Fijos del grupo ÷ estudiantes', get: (v) => num(v.sheet?.groupFixedPerParticipant) },
  { label: 'SubTotal 2 (coste / estudiante)', get: (v) => num(v.totals?.costPerParticipant) },
  { label: '% Comisión', get: (v) => Number(v.targetMarginRate) * 100, suffix: () => '%' },
  { label: 'Comisión / estudiante', get: (v) => num(v.totals?.marginPerParticipant) },
  { label: 'Precio / estudiante', get: (v) => num(v.totals?.pricePerParticipant), strong: true },
  { label: 'Estimado en pesos', get: (v) => num(v.totals?.pricePerParticipantMxn), suffix: () => ' MXN' },
  { label: 'Total chaperones', get: (v) => num(v.sheet?.totalChaperones) },
  { label: 'Margen del grupo', get: (v) => num(v.totals?.groupMargin), strong: true },
];

function StatusChip({ s, picked, won }: { s: ScenarioDto; picked: boolean; won: boolean }) {
  const st = s.latest.status;
  const [cls, text] = won
    ? ['won', 'Vendida']
    : picked
      ? ['ok', `✓ ${QUOTE_STATUS_LABEL[st]}`]
      : st === 'IN_REVIEW' || st === 'RETURNED'
        ? ['rev', QUOTE_STATUS_LABEL[st]]
        : ['draft', QUOTE_STATUS_LABEL[st]];
  return <span className={`cmp-chip ${cls}`}>{`${text} · v${s.latest.number}`}</span>;
}

/** Opción 1, 2, 3… as narrow columns; differences against the approved (or first) scenario stand out. */
function Comparison({
  items,
  pickedId,
  wonVersionId,
  canWork,
  duplicate,
}: {
  items: ScenarioDto[];
  pickedId?: string;
  wonVersionId?: string | null;
  canWork: boolean;
  duplicate: (id: string, name: string) => Promise<void>;
}) {
  const [hideZero, setHideZero] = useState(true);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const ref = items.find((s) => s.id === pickedId) ?? items[0]!;
  const many = items.length > 1;
  const pk = (s: ScenarioDto) => (s.id === pickedId ? 'picked' : '');

  const cells = (get: (v: QuoteDto) => number | null, suffix?: (v: QuoteDto) => string) =>
    items.map((s) => {
      const x = get(s.latest);
      const d = many && s.id !== ref.id ? delta(x, get(ref.latest)) : null;
      return (
        <td key={s.id} className={`num ${pk(s)} ${d !== null ? 'diff' : ''}`}>
          {x === null ? '—' : `${fmt(x)}${suffix?.(s.latest) ?? ''}`}
          {d !== null && <small className="delta">{`${d > 0 ? '+' : '−'}${n2.format(Math.abs(d))}`}</small>}
        </td>
      );
    });
  const differs = (get: (v: QuoteDto) => number | null) =>
    items.some((s) => delta(get(s.latest), get(ref.latest)) !== null);

  const toggle = (key: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const section = (key: string, title: string, sub?: (v: QuoteDto) => number | null) => (
    <tr className="cmp-sec">
      <th scope="rowgroup">
        <button type="button" className="link" aria-expanded={!closed.has(key)} onClick={() => toggle(key)}>
          {closed.has(key) ? '▸' : '▾'} {title}
        </button>
      </th>
      {sub ? cells(sub) : items.map((s) => <td key={s.id} className={pk(s)} />)}
    </tr>
  );

  const blocks = SHEET_BLOCKS.map((b) => {
    const names = [
      ...new Set(
        items.flatMap((s) =>
          s.latest.lines.filter((l) => l.category === b.category).map((l) => l.description),
        ),
      ),
    ];
    const get = (n: string) => (v: QuoteDto) => conceptTotal(v, b.category, n);
    const zero = names.filter((n) => items.every((s) => !get(n)(s.latest)));
    const shown = names.filter((n) => !(hideZero && zero.includes(n)) && !(onlyDiff && !differs(get(n))));
    const subtotal = (v: QuoteDto) =>
      v.totals ? names.reduce((a, n) => a + (conceptTotal(v, b.category, n) ?? 0), 0) : null;
    return { ...b, names, zero, shown, get, subtotal };
  });

  return (
    <div className="cmp">
      <div className="cmp-tools">
        {many && (
          <span className="muted">
            <span className="cmp-legend">En naranja</span>: cambia contra{' '}
            {pickedId ? 'el escenario aprobado' : ref.name}
          </span>
        )}
        <label className="inline">
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> Ocultar
          conceptos en 0
        </label>
        {many && (
          <label className="inline">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Solo
            diferencias
          </label>
        )}
      </div>
      <div className="cmp-wrap">
        <table className="compare" aria-label="Comparar escenarios">
          <thead>
            <tr>
              <th />
              {items.map((s) => {
                const v = s.latest;
                const price = num(v.totals?.pricePerParticipant);
                return (
                  <th key={s.id} scope="col" className={pk(s)}>
                    <Link href={`/cotizaciones/${v.id}`} className="cmp-name">
                      {s.name}
                    </Link>
                    <StatusChip
                      s={s}
                      picked={s.id === pickedId}
                      won={!!wonVersionId && s.versions.some((x) => x.id === wonVersionId)}
                    />
                    <div className="cmp-group">
                      {v.participants} est · {v.chaperones} chap · {v.staff} EE
                    </div>
                    <div className="cmp-price">
                      {price === null ? '—' : n0.format(price)} <small>{v.saleCurrency}</small>
                    </div>
                    {v.totals?.pricePerParticipantMxn && (
                      <div className="cmp-group">
                        ≈ {n0.format(Number(v.totals.pricePerParticipantMxn))} MXN / est.
                      </div>
                    )}
                    <div className="cmp-acts">
                      <Link href={`/cotizaciones/${v.id}`} className="button secondary">
                        Abrir
                      </Link>
                      {canWork && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            const name = window
                              .prompt('Nombre del nuevo escenario:', `${s.name} (copia)`)
                              ?.trim();
                            if (name) void duplicate(s.id, name);
                          }}
                        >
                          Duplicar
                        </button>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) =>
              b.names.length && !(hideZero && b.zero.length === b.names.length) ? (
                <Fragment key={b.category}>
                  {section(b.category, b.title, b.subtotal)}
                  {!closed.has(b.category) && (
                    <>
                      {b.shown.map((n) => (
                        <tr key={n}>
                          <th scope="row">{n}</th>
                          {cells(b.get(n))}
                        </tr>
                      ))}
                      {hideZero && b.zero.length > 0 && (
                        <tr className="cmp-hidden">
                          <td colSpan={items.length + 1} title={b.zero.join(', ')}>
                            {b.zero.length === 1
                              ? '1 concepto en 0 oculto'
                              : `${b.zero.length} conceptos en 0 ocultos`}
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </Fragment>
              ) : null,
            )}
            {section('summary', 'Resumen por estudiante')}
            {!closed.has('summary') &&
              SUMMARY.filter(
                (r) =>
                  r.strong ||
                  ((!onlyDiff || differs(r.get)) && !(hideZero && items.every((s) => !r.get(s.latest)))),
              ).map((r) => (
                <tr key={r.label} className={r.strong ? 'cmp-total' : undefined}>
                  <th scope="row">{r.label}</th>
                  {cells(r.get, r.suffix ?? ((v) => ` ${v.saleCurrency}`))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
