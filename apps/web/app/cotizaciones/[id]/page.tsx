'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { CurrencyCode, LineCategory } from '@ee/contracts';
import { api, errorText } from '../../lib/api';
import { preview, TotalsBar } from './LiveTotals';
import { PaymentSchedule, ProposalContent } from './ProposalContent';
import { ShareLinks } from './ShareLinks';
import { VersionChanges } from './VersionChanges';
import { SheetImport } from './SheetImport';
import { SheetSummary } from './SheetSummary';
import { QuoteHeader, type Role } from './QuoteHeader';
import { PaymentPlan } from './PaymentPlan';
import { Sensitivity, VolumeMatrix } from './VolumeRisk';
import { Timeline, type TimelineData } from './Timeline';
import { FreePlaces, NewConcept, QuickLoad } from './OptionTools';
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
  type ScenarioDto,
  type SupplierDto,
  type TravelRequestDto,
} from '../../lib/types';
import { can, canExportXlsx, isOfficeAdmin, useMe } from '../../lib/useMe';
import { RequestFiles } from '../../solicitudes/RequestFiles';

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
// shortcut: the V2 model's "rentabilidad óptima" line is fixed at 18 %; read it from the approval rules if Finance moves it.
const OPTIMAL_PCT = 18;

type Tab = 'hoja' | 'conceptos' | 'pagos' | 'volumen' | 'propuesta' | 'bitacora' | 'importar';
const TAB_LABEL: Record<Tab, string> = {
  hoja: 'Hoja EE',
  conceptos: 'Grupo y conceptos',
  pagos: 'Plan de pagos',
  volumen: 'Volumen y riesgo',
  propuesta: 'Propuesta',
  bitacora: 'Línea de tiempo',
  importar: 'Importar hoja',
};
const GROUPS: { label: string; tabs: Tab[] }[] = [
  { label: 'Finanzas y cotización', tabs: ['hoja', 'conceptos', 'pagos', 'volumen'] },
  { label: 'Propuesta y cierre', tabs: ['propuesta', 'bitacora'] },
  { label: 'Herramientas', tabs: ['importar'] },
];

/** Quote version editor (US-031, US-055) laid out like the V2 model: header, stages, tabs, live bar. */
export default function QuoteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useMe();
  const [q, setQ] = useState<QuoteDto | null>(null);
  const [req, setReq] = useState<TravelRequestDto | null>(null);
  const [draft, setDraft] = useState<QuoteDto | null>(null);
  const [marginPct, setMarginPct] = useState('0');
  // Whichever of % or final price was typed last is what gets saved.
  const [targetPrice, setTargetPrice] = useState('');
  const [byPrice, setByPrice] = useState(false);
  const [catalog, setCatalog] = useState<ConceptTemplateDto[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [officialRates, setOfficialRates] = useState<OfficialRateDto[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioDto[]>([]);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);

  const load = useCallback((v: QuoteDto) => {
    // Every save or step adds audit events: keep the timeline in step.
    api<TimelineData>(`/requests/${v.requestId}/timeline`).then(setTimeline, () => undefined);
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
        api<ScenarioDto[]>(`/requests/${v.requestId}/scenarios`).then(setScenarios, () => setScenarios([]));
        return api<TravelRequestDto>(`/requests/${v.requestId}`).then(setReq);
      },
      (e) => setError(errorText(e)),
    );
    api<ConceptTemplateDto[]>('/concept-templates').then(setCatalog, () => setCatalog([]));
    // Roles without internal costs get 403: they simply see no supplier rates.
    api<SupplierDto[]>('/suppliers').then(setSuppliers, () => setSuppliers([]));
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
  /** Current official rates for every foreign line currency (and MXN); the quote keeps its own frozen copy. */
  const officialPatch = () => {
    const found = officialRates.filter(
      (r) => r.toCurrency === draft.saleCurrency && foreign.includes(r.fromCurrency),
    );
    const missing = foreign.filter((c) => !found.some((r) => r.fromCurrency === c));
    const mxn = officialRates.find((r) => r.fromCurrency === draft.saleCurrency && r.toCurrency === 'MXN');
    const patch: Partial<QuoteDto> = {
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
      ...(mxn ? { mxnRate: mxn.rate } : {}),
    };
    const text = missing.length
      ? `Sin tipo oficial para ${missing.join(', ')} → ${draft.saleCurrency}; captúralo a mano.`
      : found.length || mxn
        ? 'Tipos de cambio oficiales aplicados; guarda para conservarlos.'
        : 'Todos los conceptos están en la moneda de venta.';
    return { patch, text };
  };
  const applyOfficialRates = () => {
    const { patch, text } = officialPatch();
    set(patch);
    setNotice(text);
  };
  /** "Renovar vigencia": 15 more days from today and today's official rates, saved with the next save. */
  const renew = () => {
    const { patch, text } = officialPatch();
    const until = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    set({ ...patch, validUntil: until });
    setNotice(`Vigencia al ${fmtDate(until)}. ${text}`);
  };
  // Allowances count both travel days: return − departure + 1 (Finance, 2026-10-22).
  const tripDays = req ? (Date.parse(req.returnDate) - Date.parse(req.departureDate)) / 86_400_000 + 1 : null;

  // Whoever edits lands on the concepts; everyone else on the computed sheet.
  const current: Tab = tab ?? (editable ? 'conceptos' : 'hoja');
  const tabs = GROUPS.flatMap((g) => g.tabs).filter((t) => t !== 'importar' || editable);
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
  const role: Role =
    me?.id === req?.assignee?.id ? 'quoter' : isAdmin ? 'admin' : approver ? 'approver' : 'viewer';
  const fileName = `${req?.folio ?? 'cotizacion'}-${q.scenarioName}-v${q.number}`.replace(/[^\w.-]+/g, '-');
  const toApproval = () => document.getElementById('autorizacion')?.scrollIntoView({ behavior: 'smooth' });

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

  /** A sent or approved version can't change: renewing it means a new draft version (new approval). */
  async function newVersion() {
    if (!q) return;
    setError(null);
    try {
      const v = await api<QuoteDto>(`/scenarios/${q.scenarioId}/versions`, { method: 'POST' });
      router.push(`/cotizaciones/${v.id}`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  /** V2 "Duplicar escenario (+5 alumnos)": copy of this option with five more students, then open it. */
  async function duplicatePlus5() {
    if (!q) return;
    setError(null);
    try {
      const dup = await api<ScenarioDto>(`/scenarios/${q.scenarioId}/duplicate`, {
        method: 'POST',
        body: { name: `${q.scenarioName} (+5 estudiantes)`.slice(0, 150) },
      });
      const v = await api<QuoteDto>(`/quotes/${dup.latest.id}`, {
        method: 'PATCH',
        body: { participants: dup.latest.participants + 5, rowVersion: dup.latest.rowVersion },
      });
      router.push(`/cotizaciones/${v.id}`);
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
          showVolumePrices: draft.showVolumePrices,
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

  const optionCount = Math.max(scenarios.length, 1);
  // Same count the timeline shows: a comment's audit event is not listed twice.
  const eventCount = timeline
    ? timeline.events.filter((e) => e.action !== 'request.commented').length + timeline.comments.length
    : null;
  const goodPct = live.ok && Number(live.pct) >= OPTIMAL_PCT;

  return (
    <>
      <QuoteHeader
        q={q}
        req={req}
        role={role}
        optionCount={optionCount}
        eventCount={eventCount}
        onStage={(i) => {
          if (i === 0) router.push(`/solicitudes/${q.requestId}`);
          else if (i === 1) setTab(editable ? 'conceptos' : 'hoja');
          else toApproval();
        }}
        actions={
          <>
            <Link className="button" href={`/cotizaciones/${q.id}/propuesta`}>
              Propuesta PDF
            </Link>
            <button type="button" className="secondary" onClick={() => setTab('bitacora')}>
              Línea de tiempo{eventCount !== null ? ` (${eventCount})` : ''}
            </button>
            {scenarios.length > 1 && (
              <Link className="button secondary" href={`/solicitudes/${q.requestId}#escenarios`}>
                Comparar {scenarios.length} opciones
              </Link>
            )}
            {editable && (
              <button type="button" className="secondary" onClick={() => setTab('importar')}>
                Importar Excel / Sheets con IA
              </button>
            )}
            {/* Plain link: same-origin download carries the session cookie. */}
            {req && canExportXlsx(me, req.office.id) && (
              <a className="button secondary" href={`/api/v1/quotes/${q.id}/export.xlsx`}>
                Descargar Excel interno
              </a>
            )}
            {editable && (
              <button type="button" className="secondary warn" onClick={renew}>
                Renovar vigencia (+15 d)
              </button>
            )}
          </>
        }
        expiredAction={
          editable ? (
            <button type="button" className="secondary" onClick={renew}>
              Extender +15 días y actualizar tipos de cambio
            </button>
          ) : works && q.status === 'APPROVED' ? (
            <button type="button" className="secondary" onClick={() => void newVersion()}>
              Crear versión nueva para renovar
            </button>
          ) : null
        }
        nextStep={
          <>
            {q.status === 'SENT' ? (
              <Link className="button" href={`/solicitudes/${q.requestId}`}>
                Ir a la solicitud (ganada o perdida)
              </Link>
            ) : (
              <button type="button" onClick={toApproval}>
                {q.status === 'APPROVED' ? 'Ir a registrar el envío' : 'Ir al paso de autorización'}
              </button>
            )}
          </>
        }
      />

      <TotalsBar
        p={live}
        currency={draft.saleCurrency}
        label={`${q.scenarioName} (${draft.participants} est.${tripDays ? ` · ${tripDays} días` : ''})`}
        options={scenarios.map((s) => ({ id: s.latest.id, name: s.name, active: s.id === q.scenarioId }))}
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={editable ? () => void save() : undefined}
      />

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

      {scenarios.length > 0 && (
        <section className="card compact scenario-chips" aria-label="Escenarios de la solicitud">
          <div className="chips">
            {scenarios.map((s, i) => (
              <Link
                key={s.id}
                href={`/cotizaciones/${s.latest.id}`}
                className={s.id === q.scenarioId ? 'chip active' : 'chip'}
                aria-current={s.id === q.scenarioId ? 'page' : undefined}
              >
                Escenario {String.fromCharCode(65 + (i % 26))}: {s.latest.participants} est. +{' '}
                {s.latest.chaperones + s.latest.staff} chap. (v{s.latest.number} ·{' '}
                {QUOTE_STATUS_LABEL[s.latest.status]})
              </Link>
            ))}
          </div>
          {works && req?.status === 'QUOTING' && (
            <div className="row">
              <button type="button" className="secondary small" onClick={() => void duplicatePlus5()}>
                Duplicar escenario (+5 estudiantes)
              </button>
              <Link className="button secondary small" href={`/solicitudes/${q.requestId}#escenarios`}>
                Nuevo escenario
              </Link>
              {scenarios.length > 1 && (
                <Link className="button secondary small" href={`/solicitudes/${q.requestId}#escenarios`}>
                  Comparar en columnas ({scenarios.length})
                </Link>
              )}
            </div>
          )}
        </section>
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
                emailClient: f.get('emailClient') === 'on',
                message: String(f.get('message') ?? '').trim() || undefined,
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
            <label style={{ flexDirection: 'row', alignItems: 'center' }}>
              <input name="emailClient" type="checkbox" />
              Mandar el correo al colegio desde el cotizador (con liga a la propuesta por 30 días)
            </label>
            <label>
              Mensaje para el colegio (opcional)
              <textarea name="message" maxLength={2000} rows={2} />
            </label>
            <button>Registrar envío al cliente</button>
          </form>
        )}
        <VersionChanges quoteId={q.id} rowVersion={q.rowVersion} />
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

      <section className="card" id="expediente" aria-labelledby="expediente-titulo">
        <h2 id="expediente-titulo" style={{ marginTop: 0 }}>
          Expediente de la propuesta
        </h2>
        <p className="muted">Todo lo que se mandó al colegio con esta versión.</p>
        <p>
          <Link href={`/cotizaciones/${q.id}/propuesta`}>Propuesta para el cliente (PDF / liga)</Link>
        </p>
        {q.deliveries.length === 0 ? (
          <p className="muted">Aún no se registra ningún envío.</p>
        ) : (
          <ul>
            {q.deliveries.map((d, i) => (
              <li key={i}>
                Enviada el {fmtDate(d.sentOn)} por {CHANNEL_LABEL[d.channel]} a {d.recipients} · {d.sentBy}
                {d.notes && <span className="muted"> · {d.notes}</span>}
              </li>
            ))}
          </ul>
        )}
        {req && (
          <RequestFiles
            requestId={req.id}
            versionId={q.id}
            canUpload={req.status !== 'CANCELLED' && can(me, req.office.id, 'canEdit')}
            canDeleteAny={can(me, req.office.id, 'canDelete')}
            meId={me?.id}
          />
        )}
      </section>

      <div role="tablist" aria-label="Secciones de la cotización" className="tabs grouped">
        {GROUPS.map((g) => {
          const shown = g.tabs.filter((t) => tabs.includes(t));
          return shown.length ? (
            <Fragment key={g.label}>
              <span role="presentation" className="tab-group">
                {g.label}:
              </span>
              {shown.map((t) => (
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
                    const next = tabs[(tabs.indexOf(t) + step + tabs.length) % tabs.length]!;
                    setTab(next);
                    document.getElementById(`tab-${next}`)?.focus();
                  }}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </Fragment>
          ) : null;
        })}
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

      <div {...tabProps('pagos')}>
        <PaymentPlan draft={draft} set={set} live={live} editable={editable} fileName={fileName} />
      </div>

      <div {...tabProps('volumen')}>
        {live.ok ? (
          <>
            <Sensitivity input={live.input} d={draft} />
            <VolumeMatrix
              input={live.input}
              d={draft}
              editable={editable}
              onFix={(n) => {
                set({ participants: n });
                setNotice(`Aforo fijado en ${n} estudiantes; guarda para conservarlo.`);
              }}
              onShow={(show) => set({ showVolumePrices: show })}
              fileName={fileName}
            />
          </>
        ) : (
          <p className="muted">{live.reason}</p>
        )}
      </div>

      <div {...tabProps('bitacora')}>
        <Timeline data={timeline} folio={req?.folio ?? ''} />
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
          {editable && req && (
            <QuickLoad
              draft={draft}
              set={set}
              officeId={req.office.id}
              suppliers={suppliers}
              onMargin={(rate) => {
                setMarginPct(toPct(rate));
                setByPrice(false);
              }}
              onNotice={setNotice}
            />
          )}
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
            <div className="section-head">
              <h2 id="grupo">Grupo y precio</h2>
              <span className="muted">
                {[req?.program, req && `${req.city}, ${req.countryCode}`, tripDays && `${tripDays} días`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {live.ok && (
                <span className={goodPct ? 'pill ok' : 'pill warn'}>
                  {goodPct
                    ? `Rentabilidad óptima (≥${OPTIMAL_PCT}%)`
                    : `Comisión por debajo de ${OPTIMAL_PCT}%`}
                </span>
              )}
            </div>
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
              const rates = suppliers.flatMap((sup) =>
                sup.rates
                  .filter((r) => r.category === b.category && (!r.validUntil || r.validUntil >= today()))
                  .map((r) => ({ ...r, supplier: sup.name })),
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
                    {rates.length > 0 && (
                      <select
                        aria-label={`Tarifa de proveedor: ${b.title}`}
                        value=""
                        onChange={(e) => {
                          const r = rates.find((o) => o.id === e.target.value);
                          if (!r) return;
                          set({
                            lines: [
                              ...draft.lines,
                              {
                                ...blankLine(r.currency, b.category, r.description),
                                unitCost: r.unitCost,
                                costSource: r.supplier,
                              },
                            ],
                          });
                        }}
                      >
                        <option value="">Agregar tarifa de proveedor…</option>
                        {rates.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.supplier}: {r.description} ({r.unitCost} {r.currency})
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

          <FreePlaces draft={draft} set={set} live={live} />
          {editable && (
            <NewConcept
              draft={draft}
              set={set}
              catalog={catalog}
              tripDays={tripDays}
              canSaveToCatalog={!!me?.roles.some((r) => r.role === 'SYSTEM_ADMIN')}
              onCatalog={(c) => setCatalog([...catalog, c])}
              onNotice={setNotice}
            />
          )}
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
      </fieldset>
    </>
  );
}
