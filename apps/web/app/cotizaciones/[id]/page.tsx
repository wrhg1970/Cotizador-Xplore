'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CurrencyCode, LineCategory } from '@ee/contracts';
import { api, errorText } from '../../lib/api';
import { preview, TotalsBar } from './LiveTotals';
import { PaymentSchedule, ProposalContent } from './ProposalContent';
import { ShareLinks } from './ShareLinks';
import { SheetImport } from './SheetImport';
import { SheetSummary } from './SheetSummary';
import {
  CHANNEL_LABEL,
  fmtDate,
  fmtDateTime,
  isAuthorized,
  PENDING_LEGEND,
  QUOTE_STATUS_LABEL,
  SHEET_BLOCKS,
  type ConceptTemplateDto,
  type FxRateDto,
  type OfficialRateDto,
  type QuoteDto,
  type QuoteLineDto,
  type TravelRequestDto,
} from '../../lib/types';
import { canExportXlsx, isOfficeAdmin, useMe } from '../../lib/useMe';

const today = () => new Date().toISOString().slice(0, 10);
const blankLine = (
  currency: CurrencyCode,
  category: LineCategory,
  description = '',
  quantity = '1',
): QuoteLineDto => ({
  category,
  description,
  quantity,
  unitCost: '0',
  currency,
  internalOnly: false,
});
// Margin travels as a 0..1 decimal; people type it as a percentage.
const toPct = (rate: string) => String(Number((Number(rate) * 100).toFixed(4)));
const fromPct = (pct: string) => String(Number((Number(pct) / 100).toFixed(6)));

type Tab = 'hoja' | 'conceptos' | 'propuesta' | 'importar';
const TAB_LABEL: Record<Tab, string> = {
  hoja: 'Hoja EE',
  conceptos: 'Grupo y conceptos',
  propuesta: 'Propuesta',
  importar: 'Importar hoja',
};

/** Quote version editor (US-031, US-055): group sizes, lines, FX and live totals. */
export default function QuoteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [q, setQ] = useState<QuoteDto | null>(null);
  const [req, setReq] = useState<TravelRequestDto | null>(null);
  const [draft, setDraft] = useState<QuoteDto | null>(null);
  const [marginPct, setMarginPct] = useState('0');
  // Whichever of % or final price was typed last is what gets saved.
  const [targetPrice, setTargetPrice] = useState('');
  const [byPrice, setByPrice] = useState(false);
  const [catalog, setCatalog] = useState<ConceptTemplateDto[]>([]);
  const [officialRates, setOfficialRates] = useState<OfficialRateDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);

  const load = useCallback((v: QuoteDto) => {
    setQ(v);
    setDraft(v);
    setMarginPct(toPct(v.targetMarginRate));
    setTargetPrice(
      Number(v.totals?.pricePerParticipant) > 0
        ? String(Math.round(Number(v.totals!.pricePerParticipant)))
        : '',
    );
    setByPrice(false);
  }, []);

  useEffect(() => {
    api<QuoteDto>(`/quotes/${id}`).then(
      (v) => {
        load(v);
        return api<TravelRequestDto>(`/requests/${v.requestId}`).then(setReq);
      },
      (e) => setError(errorText(e)),
    );
    api<ConceptTemplateDto[]>('/concept-templates').then(setCatalog, () => setCatalog([]));
    api<OfficialRateDto[]>('/official-rates').then(setOfficialRates, () => setOfficialRates([]));
  }, [id, load]);

  if (!q || !draft) return error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>;

  const editable =
    ['DRAFT', 'RETURNED'].includes(q.status) &&
    req?.status === 'QUOTING' &&
    (isOfficeAdmin(me, req.office.id) || me?.id === req.assignee?.id);
  const set = (patch: Partial<QuoteDto>) => setDraft({ ...draft, ...patch });
  const setLine = (i: number, patch: Partial<QuoteLineDto>) =>
    set({ lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const foreign = [...new Set(draft.lines.map((l) => l.currency))].filter((c) => c !== draft.saleCurrency);
  const missingFx = foreign.filter((c) => !draft.fxRates.some((f) => f.fromCurrency === c && f.rate));
  const live = preview(draft, marginPct, targetPrice, byPrice);
  const dirty = draft !== q || byPrice || marginPct !== toPct(q.targetMarginRate);
  /** New rate row: the first currency still missing, with a source so the server accepts it. */
  const addFx = (from?: CurrencyCode) => {
    const taken = new Set(draft.fxRates.map((f) => f.fromCurrency));
    const pick =
      from ??
      missingFx.find((c) => !taken.has(c)) ??
      CurrencyCode.options.find((c) => c !== draft.saleCurrency && !taken.has(c))!;
    const rest = draft.fxRates.filter((f) => f.fromCurrency !== pick);
    set({
      fxRates: [
        ...rest,
        {
          fromCurrency: pick,
          toCurrency: draft.saleCurrency,
          rate: '',
          rateDate: today(),
          source: 'Captura manual',
        },
      ],
    });
  };
  const setFx = (i: number, patch: Partial<FxRateDto>) =>
    set({ fxRates: draft.fxRates.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  /** Copies the current official rate for every foreign line currency; the quote keeps its own frozen copy. */
  const applyOfficialRates = () => {
    const found = officialRates.filter(
      (r) => r.toCurrency === draft.saleCurrency && foreign.includes(r.fromCurrency),
    );
    const missing = foreign.filter((c) => !found.some((r) => r.fromCurrency === c));
    set({
      fxRates: [
        ...draft.fxRates.filter((f) => !found.some((r) => r.fromCurrency === f.fromCurrency)),
        ...found.map((r) => ({
          fromCurrency: r.fromCurrency,
          toCurrency: draft.saleCurrency,
          rate: r.rate,
          rateDate: r.rateDate,
          source: `Tabla oficial EE · ${r.source}`.slice(0, 150),
        })),
      ],
    });
    setNotice(
      missing.length
        ? `Sin tipo oficial para ${missing.join(', ')} → ${draft.saleCurrency}; captúralo a mano.`
        : found.length
          ? 'Tipos de cambio oficiales aplicados; guarda para conservarlos.'
          : 'Todos los conceptos están en la moneda de venta.',
    );
  };
  // Allowances count both travel days: return − departure + 1 (Finance, 2026-10-22).
  const tripDays = req ? (Date.parse(req.returnDate) - Date.parse(req.departureDate)) / 86_400_000 + 1 : null;

  // Whoever edits lands on the concepts; everyone else on the computed sheet.
  const current: Tab = tab ?? (editable ? 'conceptos' : 'hoja');
  const tabs: Tab[] = editable
    ? ['hoja', 'conceptos', 'propuesta', 'importar']
    : ['hoja', 'conceptos', 'propuesta'];
  const tabProps = (t: Tab) => ({
    id: `panel-${t}`,
    role: 'tabpanel',
    'aria-labelledby': `tab-${t}`,
    hidden: current !== t,
  });

  const isAdmin = !!req && isOfficeAdmin(me, req.office.id);
  const works = !!req && (isAdmin || me?.id === req.assignee?.id);
  const approver =
    !!req &&
    !!me?.roles.some(
      (r) => r.role === 'SYSTEM_ADMIN' || (r.officeId === req.office.id && r.role === 'APPROVER'),
    ) &&
    me.id !== req.assignee?.id;

  /** Approval steps (US-071..074); submitting saves pending edits first. */
  async function act(action: string, body: object = {}) {
    if (!q) return;
    setError(null);
    try {
      const saved = action === 'submit' && editable ? await save() : q;
      if (!saved) return;
      load(
        await api<QuoteDto>(`/quotes/${q.id}/${action}`, {
          method: 'POST',
          body: { ...body, rowVersion: saved.rowVersion },
        }),
      );
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function save(): Promise<QuoteDto | undefined> {
    if (!draft || !q) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api<QuoteDto>(`/quotes/${q.id}`, {
        method: 'PATCH',
        body: {
          rowVersion: q.rowVersion,
          saleCurrency: draft.saleCurrency,
          ...(byPrice
            ? { targetPricePerParticipant: targetPrice.trim() }
            : { targetMarginRate: fromPct(marginPct) }),
          mxnRate: draft.mxnRate?.trim() || null,
          participants: draft.participants,
          chaperones: draft.chaperones,
          staff: draft.staff,
          validUntil: draft.validUntil || null,
          assumptions: draft.assumptions ?? '',
          paymentPlan: draft.paymentPlan,
          studentsPerFreePlace: draft.studentsPerFreePlace,
          freePlaceBenefit: draft.freePlaceBenefit,
          itinerary: draft.itinerary?.map((d) => ({ ...d, details: d.details?.trim() || undefined })) ?? null,
          exclusions: draft.exclusions.map((x) => x.trim()).filter(Boolean),
          coverAttachmentId: draft.coverAttachmentId,
          // Server-only fields would fail strict validation.
          lines: draft.lines.map(({ id: _id, lineTotal: _t, ...l }) => ({
            ...l,
            costSource: l.costSource ?? undefined,
          })),
          fxRates: draft.fxRates.map(({ fromCurrency, rate, rateDate, source }) => ({
            fromCurrency,
            rate,
            rateDate,
            source,
          })),
        },
      });
      load(saved);
      return saved;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <p>
        <Link href={`/solicitudes/${q.requestId}`}>
          ← {req ? `${req.folio} · ${req.groupName}` : 'Solicitud'}
        </Link>
      </p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>
          {q.scenarioName} · v{q.number}
        </h1>
        <span className="badge">{QUOTE_STATUS_LABEL[q.status]}</span>
      </div>

      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {q.warnings.map((w) => (
        <p key={w.code + w.message} className="error">
          {w.message}
        </p>
      ))}

      {!isAuthorized(q.status) && (
        <p className="legend" role="status">
          {PENDING_LEGEND}
        </p>
      )}

      <section className="card" aria-labelledby="autorizacion">
        <h2 id="autorizacion" style={{ marginTop: 0 }}>
          Autorización
        </h2>
        <div className="row">
          <Link className="button secondary" href={`/cotizaciones/${q.id}/propuesta`}>
            Ver propuesta para compartir
          </Link>
          {works && ['DRAFT', 'RETURNED'].includes(q.status) && (
            <button onClick={() => void act('submit')}>Enviar a autorización</button>
          )}
          {approver && q.status === 'IN_REVIEW' && (
            <>
              <button onClick={() => void act('approve')}>Autorizar viaje</button>
              <button
                className="danger"
                onClick={() => {
                  const comment = window.prompt('Motivo de la devolución (obligatorio):')?.trim();
                  if (comment) void act('return', { comment });
                }}
              >
                Devolver con comentarios
              </button>
            </>
          )}
          {works && (
            <button
              className="secondary"
              onClick={async () => {
                const name = window.prompt('Nombre de la plantilla:', q.scenarioName)?.trim();
                if (!name) return;
                setError(null);
                try {
                  await api(`/quotes/${q.id}/template`, { method: 'POST', body: { name } });
                  setNotice(`Plantilla "${name}" guardada para la oficina`);
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              Guardar como plantilla
            </button>
          )}
          {/* Plain link: same-origin download carries the session cookie. */}
          {req && canExportXlsx(me, req.office.id) && (
            <a className="button secondary" href={`/api/v1/quotes/${q.id}/export.xlsx`}>
              Descargar Excel interno
            </a>
          )}
        </div>
        {works && q.status === 'APPROVED' && (
          <form
            className="row"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act('send', {
                recipients: String(f.get('recipients')).trim(),
                channel: f.get('channel'),
                sentOn: f.get('sentOn'),
                notes: String(f.get('notes') ?? '').trim() || undefined,
              });
            }}
          >
            <label>
              Enviada a
              <input name="recipients" required maxLength={500} placeholder="correo o nombre del contacto" />
            </label>
            <label>
              Medio
              <select name="channel" defaultValue="EMAIL">
                {Object.entries(CHANNEL_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fecha de envío
              <input name="sentOn" type="date" required defaultValue={today()} />
            </label>
            <label>
              Notas
              <input name="notes" maxLength={2000} />
            </label>
            <button>Registrar envío al cliente</button>
          </form>
        )}
        {q.deliveries.length > 0 && (
          <ul>
            {q.deliveries.map((d, i) => (
              <li key={i}>
                Enviada el {fmtDate(d.sentOn)} por {CHANNEL_LABEL[d.channel]} a {d.recipients} · {d.sentBy}
                {d.notes && <span className="muted"> · {d.notes}</span>}
              </li>
            ))}
          </ul>
        )}
        <ShareLinks
          quoteId={q.id}
          canShare={
            works &&
            !!req &&
            ['APPROVED', 'SENT'].includes(q.status) &&
            ['QUOTING', 'SENT', 'WON'].includes(req.status)
          }
          canRevoke={works}
        />
        {q.reviews.length > 0 && (
          <ol className="timeline">
            {q.reviews.map((r, i) => (
              <li key={i}>
                {r.decision === 'APPROVED' ? 'Autorizó' : 'Devolvió'} · {r.reviewer}{' '}
                <span className="muted">{fmtDateTime(r.at)}</span>
                {r.comment && <p style={{ margin: '4px 0 0' }}>{r.comment}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <div role="tablist" aria-label="Secciones de la cotización" className="tabs">
        {tabs.map((t, i) => (
          <button
            key={t}
            id={`tab-${t}`}
            role="tab"
            aria-selected={current === t}
            aria-controls={`panel-${t}`}
            tabIndex={current === t ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              const next = tabs[(i + step + tabs.length) % tabs.length]!;
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <div {...tabProps('hoja')}>
        <SheetSummary q={q} />
        {(q.paymentSchedule || q.freePlaces !== null) && (
          <section className="card" aria-labelledby="plan-guardado" style={{ marginTop: 16 }}>
            <h2 id="plan-guardado" style={{ marginTop: 0 }}>
              Plan de pagos y lugares liberados (guardado)
            </h2>
            {q.freePlaces !== null && (
              <p>
                Lugares liberados: <strong>{q.freePlaces}</strong> (1 por cada {q.studentsPerFreePlace}{' '}
                estudiantes, para {q.freePlaceBenefit === 'STUDENT' ? 'beca de estudiante' : 'chaperón'})
              </p>
            )}
            <PaymentSchedule q={q} />
          </section>
        )}
      </div>

      {editable && (
        <div {...tabProps('importar')}>
          <SheetImport
            quoteId={q.id}
            onApply={(p, mode) => {
              set({
                lines: mode === 'replace' ? p.lines : [...draft.lines, ...p.lines],
                ...(p.itinerary.length ? { itinerary: p.itinerary } : {}),
                ...(p.exclusions.length ? { exclusions: p.exclusions } : {}),
              });
              if (p.targetMarginRate) {
                setMarginPct(toPct(p.targetMarginRate));
                setByPrice(false);
              }
              setNotice('Conceptos importados: revísalos y pulsa “Guardar y calcular”.');
              setTab('conceptos');
            }}
          />
        </div>
      )}

      <fieldset disabled={!editable} className="editor">
        <div {...tabProps('conceptos')}>
          <section className="card compact" aria-labelledby="fx">
            <div className="section-head">
              <h2 id="fx">Tipos de cambio</h2>
              <span className="muted">
                Unidades de {draft.saleCurrency} por 1 unidad de la otra moneda, con fecha y fuente.
              </span>
              <div className="row">
                <button className="secondary" onClick={() => addFx()}>
                  Agregar tipo de cambio
                </button>
                <button className="secondary" onClick={applyOfficialRates}>
                  Usar tipos de cambio oficiales
                </button>
              </div>
            </div>
            {missingFx.length > 0 && (
              <p className="error" style={{ margin: '0 0 8px' }}>
                Falta el tipo de cambio de {missingFx.map((c) => `${c} → ${draft.saleCurrency}`).join(', ')}{' '}
                para calcular.{' '}
                {missingFx.map((c) => (
                  <button key={c} className="secondary small" onClick={() => addFx(c)}>
                    Capturar {c}
                  </button>
                ))}
              </p>
            )}
            <div className="fields">
              {draft.fxRates.map((f, i) => (
                <div className="fx-row" key={i}>
                  <label>
                    De
                    <select
                      value={f.fromCurrency}
                      onChange={(e) => setFx(i, { fromCurrency: e.target.value as CurrencyCode })}
                    >
                      {CurrencyCode.options.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tipo de cambio
                    <input
                      inputMode="decimal"
                      value={f.rate}
                      placeholder="0.00"
                      onChange={(e) => setFx(i, { rate: e.target.value.trim() })}
                    />
                  </label>
                  <label>
                    Fecha
                    <input
                      type="date"
                      value={f.rateDate}
                      onChange={(e) => setFx(i, { rateDate: e.target.value })}
                    />
                  </label>
                  <label>
                    Fuente
                    <input
                      value={f.source}
                      maxLength={150}
                      placeholder="Banxico, banco, proveedor…"
                      onChange={(e) => setFx(i, { source: e.target.value })}
                    />
                  </label>
                  <button
                    className="secondary small"
                    aria-label={`Quitar tipo de cambio ${f.fromCurrency}`}
                    onClick={() => set({ fxRates: draft.fxRates.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {draft.saleCurrency !== 'MXN' && (
                <label className="fx-mxn">
                  Tipo de cambio a MXN (aproximado)
                  <input
                    inputMode="decimal"
                    value={draft.mxnRate ?? ''}
                    placeholder="20.39"
                    onChange={(e) => set({ mxnRate: e.target.value })}
                  />
                </label>
              )}
            </div>
          </section>

          <section className="card compact" aria-labelledby="grupo">
            <h2 id="grupo">Grupo y precio</h2>
            <div className="fields">
              <label>
                Estudiantes
                <input
                  type="number"
                  min={1}
                  value={draft.participants}
                  onChange={(e) => set({ participants: Number(e.target.value) })}
                />
              </label>
              <label>
                Chaperones de la escuela
                <input
                  type="number"
                  min={0}
                  value={draft.chaperones}
                  onChange={(e) => set({ chaperones: Number(e.target.value) })}
                />
              </label>
              <label>
                Chaperones EE
                <input
                  type="number"
                  min={0}
                  value={draft.staff}
                  onChange={(e) => set({ staff: Number(e.target.value) })}
                />
              </label>
              <label>
                Moneda de venta
                <select
                  value={draft.saleCurrency}
                  onChange={(e) => set({ saleCurrency: e.target.value as CurrencyCode })}
                >
                  {CurrencyCode.options.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                % Comisión (sobre el precio final)
                <input
                  type="number"
                  min={0}
                  max={99.9999}
                  step="0.01"
                  value={marginPct}
                  onChange={(e) => {
                    setMarginPct(e.target.value);
                    setByPrice(false);
                  }}
                />
              </label>
              <label>
                Precio final por estudiante
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={targetPrice}
                  title={
                    byPrice
                      ? 'Al guardar se calcula el % que da este precio'
                      : 'O escribe el precio y se calcula el %'
                  }
                  onChange={(e) => {
                    setTargetPrice(e.target.value);
                    setByPrice(true);
                  }}
                />
              </label>
              <label>
                Vigencia
                <input
                  type="date"
                  value={draft.validUntil ?? ''}
                  onChange={(e) => set({ validUntil: e.target.value || null })}
                />
              </label>
            </div>
          </section>

          <section aria-labelledby="conceptos">
            <div className="section-head">
              <h2 id="conceptos">Conceptos</h2>
              <span className="muted">
                En gastos por día, la cantidad son los días
                {tripDays ? ` (este viaje: ${tripDays}, contando salida y regreso)` : ''}. El precio final se
                redondea hacia arriba al número entero.
              </span>
            </div>
            {SHEET_BLOCKS.map((b) => {
              const rows = draft.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.category === b.category);
              const used = new Set(rows.map(({ l }) => l.description));
              const options = catalog.filter(
                (c) => c.category === b.category && c.active && !used.has(c.label),
              );
              return (
                <details key={b.category} className="card compact block" open>
                  <summary>
                    <h3>{b.title}</h3>
                    <span className="muted">
                      {rows.length} {rows.length === 1 ? 'concepto' : 'conceptos'} · {b.hint}
                    </span>
                    {live.ok && (
                      <span className="num subtotal">
                        {live.byCategory[b.category]} {draft.saleCurrency}
                      </span>
                    )}
                  </summary>
                  {rows.length > 0 && (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Concepto</th>
                            <th>Cantidad</th>
                            <th>Costo unitario</th>
                            <th>Moneda</th>
                            <th>Interno</th>
                            <th className="num">Total {draft.saleCurrency}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ l, i }) => (
                            <tr key={i}>
                              <td className="wide">
                                <input
                                  aria-label={`Concepto ${i + 1}`}
                                  value={l.description}
                                  maxLength={300}
                                  onChange={(e) => setLine(i, { description: e.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={`Cantidad ${i + 1}`}
                                  inputMode="decimal"
                                  size={5}
                                  value={l.quantity}
                                  onChange={(e) => setLine(i, { quantity: e.target.value.trim() })}
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={`Costo ${i + 1}`}
                                  inputMode="decimal"
                                  size={9}
                                  value={l.unitCost}
                                  onChange={(e) => setLine(i, { unitCost: e.target.value.trim() })}
                                />
                              </td>
                              <td>
                                <select
                                  aria-label={`Moneda ${i + 1}`}
                                  value={l.currency}
                                  onChange={(e) => setLine(i, { currency: e.target.value as CurrencyCode })}
                                >
                                  {CurrencyCode.options.map((c) => (
                                    <option key={c}>{c}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`Solo interno ${i + 1}`}
                                  checked={l.internalOnly}
                                  onChange={(e) => setLine(i, { internalOnly: e.target.checked })}
                                />
                              </td>
                              <td className="num">{live.ok ? live.lineTotals[i] : '—'}</td>
                              <td>
                                <button
                                  className="secondary small"
                                  aria-label={`Quitar ${i + 1}`}
                                  onClick={() => set({ lines: draft.lines.filter((_, j) => j !== i) })}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 8 }}>
                    {options.length > 0 && (
                      <select
                        aria-label={`Rubro del catálogo: ${b.title}`}
                        value=""
                        onChange={(e) => {
                          const c = options.find((o) => o.id === e.target.value);
                          if (!c) return;
                          const qty = c.perTripDay && tripDays ? String(tripDays) : '1';
                          set({
                            lines: [
                              ...draft.lines,
                              {
                                ...blankLine(draft.saleCurrency, b.category, c.label, qty),
                                internalOnly: c.internalOnly,
                              },
                            ],
                          });
                        }}
                      >
                        <option value="">Agregar rubro del catálogo…</option>
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      className="secondary small"
                      aria-label={`Agregar concepto: ${b.title}`}
                      onClick={() =>
                        set({ lines: [...draft.lines, blankLine(draft.saleCurrency, b.category)] })
                      }
                    >
                      + Agregar otro concepto
                    </button>
                  </div>
                </details>
              );
            })}
          </section>
        </div>

        <div {...tabProps('propuesta')}>
          <ProposalContent draft={draft} set={set} />

          <section aria-labelledby="supuestos">
            <h2 id="supuestos">Supuestos</h2>
            <label>
              Supuestos y condiciones
              <textarea
                value={draft.assumptions ?? ''}
                maxLength={4000}
                onChange={(e) => set({ assumptions: e.target.value })}
              />
            </label>
          </section>
        </div>

        {editable && (current === 'conceptos' || current === 'propuesta') && (
          <TotalsBar
            p={live}
            currency={draft.saleCurrency}
            dirty={dirty}
            saving={saving}
            error={error}
            onSave={() => void save()}
          />
        )}
      </fieldset>
    </>
  );
}
