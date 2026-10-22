'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CurrencyCode, LineCategory } from '@ee/contracts';
import { api, errorText } from '../../lib/api';
import {
  CATEGORY_LABEL,
  QUOTE_STATUS_LABEL,
  type FxRateDto,
  type QuoteDto,
  type QuoteLineDto,
  type TravelRequestDto,
} from '../../lib/types';
import { isOfficeAdmin, useMe } from '../../lib/useMe';

const today = () => new Date().toISOString().slice(0, 10);
const blankLine = (currency: CurrencyCode): QuoteLineDto => ({
  category: 'PER_PARTICIPANT',
  description: '',
  quantity: '1',
  unitCost: '0',
  currency,
  internalOnly: false,
});
// Margin travels as a 0..1 decimal; people type it as a percentage.
const toPct = (rate: string) => String(Number((Number(rate) * 100).toFixed(4)));
const fromPct = (pct: string) => String(Number((Number(pct) / 100).toFixed(6)));

/** Quote version editor (US-031, US-055): group sizes, lines, FX and live totals. */
export default function QuoteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [q, setQ] = useState<QuoteDto | null>(null);
  const [req, setReq] = useState<TravelRequestDto | null>(null);
  const [draft, setDraft] = useState<QuoteDto | null>(null);
  const [marginPct, setMarginPct] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback((v: QuoteDto) => {
    setQ(v);
    setDraft(v);
    setMarginPct(toPct(v.targetMarginRate));
  }, []);

  useEffect(() => {
    api<QuoteDto>(`/quotes/${id}`).then(
      (v) => {
        load(v);
        return api<TravelRequestDto>(`/requests/${v.requestId}`).then(setReq);
      },
      (e) => setError(errorText(e)),
    );
  }, [id, load]);

  if (!q || !draft) return error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>;

  const editable =
    ['DRAFT', 'RETURNED'].includes(q.status) &&
    req?.status === 'QUOTING' &&
    (isOfficeAdmin(me, req.office.id) || me?.id === req.assignee?.id);
  const set = (patch: Partial<QuoteDto>) => setDraft({ ...draft, ...patch });
  const setLine = (i: number, patch: Partial<QuoteLineDto>) =>
    set({ lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setFx = (i: number, patch: Partial<FxRateDto>) =>
    set({ fxRates: draft.fxRates.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const t = q.totals;
  const cur = q.saleCurrency;

  async function save() {
    if (!draft || !q) return;
    setSaving(true);
    setError(null);
    try {
      load(
        await api<QuoteDto>(`/quotes/${q.id}`, {
          method: 'PATCH',
          body: {
            rowVersion: q.rowVersion,
            saleCurrency: draft.saleCurrency,
            targetMarginRate: fromPct(marginPct),
            participants: draft.participants,
            chaperones: draft.chaperones,
            staff: draft.staff,
            validUntil: draft.validUntil || null,
            assumptions: draft.assumptions ?? '',
            lines: draft.lines.map(({ lineTotal: _t, ...l }) => ({
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
        }),
      );
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

      <section className="card" aria-labelledby="resumen">
        <h2 id="resumen" style={{ marginTop: 0 }}>
          Resumen (guardado)
        </h2>
        {t ? (
          <dl className="facts">
            <dt>Conceptos por estudiante</dt>
            <dd>
              {t.directPerParticipant} {cur}
            </dd>
            <dt>Gastos del líder y fijos ÷ estudiantes</dt>
            <dd>
              {t.sharedPerParticipant} {cur}
            </dd>
            <dt>Coste por estudiante</dt>
            <dd>
              {t.costPerParticipant} {cur}
            </dd>
            <dt>Margen por estudiante</dt>
            <dd>
              {t.marginPerParticipant} {cur}
            </dd>
            <dt>Precio final por estudiante</dt>
            <dd>
              <strong>
                {t.pricePerParticipant} {cur}
              </strong>
            </dd>
            <dt>Margen del grupo</dt>
            <dd>
              {t.groupMargin} {cur}
            </dd>
          </dl>
        ) : (
          <p className="muted">Sin totales hasta registrar los tipos de cambio que faltan.</p>
        )}
      </section>

      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
        <section aria-labelledby="grupo">
          <h2 id="grupo">Grupo y precio</h2>
          <div className="row">
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
              Margen sobre venta (%)
              <input
                type="number"
                min={0}
                max={99.9999}
                step="0.01"
                value={marginPct}
                onChange={(e) => setMarginPct(e.target.value)}
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
          <h2 id="conceptos">Conceptos</h2>
          <p className="muted">
            Por estudiante se suma al precio de cada estudiante. Chaperones, fijos y fondo de emergencia se
            reparten entre los estudiantes. En viáticos, la cantidad son los días.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Concepto</th>
                  <th>Cantidad</th>
                  <th>Costo unitario</th>
                  <th>Moneda</th>
                  <th>Interno</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        aria-label={`Tipo ${i + 1}`}
                        value={l.category}
                        onChange={(e) => setLine(i, { category: e.target.value as LineCategory })}
                      >
                        {LineCategory.options.map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
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
                        value={l.quantity}
                        onChange={(e) => setLine(i, { quantity: e.target.value.trim() })}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Costo ${i + 1}`}
                        inputMode="decimal"
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
                    <td>{l.lineTotal ?? '—'}</td>
                    <td>
                      <button
                        className="secondary"
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
          <button
            className="secondary"
            onClick={() => set({ lines: [...draft.lines, blankLine(draft.saleCurrency)] })}
          >
            Agregar concepto
          </button>
        </section>

        <section aria-labelledby="fx">
          <h2 id="fx">Tipos de cambio</h2>
          <p className="muted">
            Unidades de {draft.saleCurrency} por 1 unidad de la otra moneda, con fecha y fuente.
          </p>
          {draft.fxRates.map((f, i) => (
            <div className="row" key={i}>
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
                  onChange={(e) => setFx(i, { source: e.target.value })}
                />
              </label>
              <button
                className="secondary"
                onClick={() => set({ fxRates: draft.fxRates.filter((_, j) => j !== i) })}
              >
                Quitar
              </button>
            </div>
          ))}
          <button
            className="secondary"
            onClick={() =>
              set({
                fxRates: [
                  ...draft.fxRates,
                  {
                    fromCurrency: draft.saleCurrency === 'MXN' ? 'USD' : 'MXN',
                    toCurrency: draft.saleCurrency,
                    rate: '',
                    rateDate: today(),
                    source: '',
                  },
                ],
              })
            }
          >
            Agregar tipo de cambio
          </button>
        </section>

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

        {editable && (
          <p>
            <button disabled={saving} onClick={save}>
              {saving ? 'Guardando…' : 'Guardar y calcular'}
            </button>
          </p>
        )}
      </fieldset>
    </>
  );
}
