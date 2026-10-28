import Link from 'next/link';
import {
  calculateQuote,
  D,
  dec,
  marginRateForPrice,
  QuoteEngineError,
  type QuoteInput,
  roundMoney,
} from '@ee/quote-engine';
import type { QuoteDto } from '../../lib/types';

const money = (x: InstanceType<typeof D>) => roundMoney(x, 2).toFixed(2);

export type Preview =
  | {
      ok: true;
      cost: string;
      price: string;
      group: string;
      margin: string;
      marginEach: string;
      pct: string;
      mxn: string | null;
      lineTotals: string[];
      byCategory: Record<string, string>;
      /** Engine input with the effective margin, for what-if tables (volume, sensitivity). */
      input: QuoteInput;
    }
  | { ok: false; reason: string };

/**
 * Unsaved figures with the same engine the API runs (packages/quote-engine), so the bar matches
 * "Guardar y calcular" to the cent. A typed final price derives the % like the server does.
 */
export function preview(d: QuoteDto, marginPct: string, targetPrice: string, byPrice: boolean): Preview {
  try {
    const input: QuoteInput = {
      saleCurrency: d.saleCurrency,
      participants: d.participants,
      chaperones: d.chaperones,
      staff: d.staff,
      // Same 6 decimals the editor saves (fromPct in page.tsx).
      targetMarginRate: dec(marginPct.trim() || '0')
        .div(100)
        .toDecimalPlaces(6),
      lines: d.lines.map((l) => ({
        category: l.category,
        quantity: dec(l.quantity || '0'),
        unitCost: dec(l.unitCost || '0'),
        currency: l.currency,
      })),
      fxRates: Object.fromEntries(
        d.fxRates.filter((f) => f.rate).map((f) => [f.fromCurrency, dec(f.rate)] as const),
      ),
      mxnRate: d.saleCurrency !== 'MXN' && d.mxnRate ? dec(d.mxnRate) : null,
    };
    if (!d.participants) return { ok: false, reason: 'Captura el número de estudiantes' };
    let r = calculateQuote(input);
    if (byPrice && /^[1-9]\d*$/.test(targetPrice.trim())) {
      input.targetMarginRate = marginRateForPrice(r.costPerParticipant, new D(targetPrice.trim()));
      r = calculateQuote(input);
    }
    return {
      ok: true,
      cost: money(r.costPerParticipant),
      price: money(r.pricePerParticipant),
      group: money(r.groupPrice),
      margin: money(r.groupMargin),
      marginEach: money(r.marginPerParticipant),
      pct: r.pricePerParticipant.isZero()
        ? '0'
        : String(Number(r.marginPerParticipant.div(r.pricePerParticipant).mul(100).toFixed(2))),
      mxn: r.pricePerParticipantMxn && money(r.pricePerParticipantMxn),
      lineTotals: r.lineTotals.map(money),
      byCategory: Object.fromEntries(Object.entries(r.byCategory).map(([k, v]) => [k, money(v)])),
      input,
    };
  } catch (e) {
    if (!(e instanceof QuoteEngineError)) throw e;
    return {
      ok: false,
      reason:
        e.code === 'INVALID_AMOUNT'
          ? 'Hay una cantidad o costo con formato inválido (usa punto decimal)'
          : e.code === 'RATE_OUT_OF_RANGE'
            ? 'El % de comisión debe ser menor que 100 y el precio mayor que el costo'
            : e.message,
    };
  }
}

/**
 * Active scenario bar, pinned to the top: live figures from the same engine, the request's other
 * options and, for whoever edits, the unsaved state and the save button.
 */
export function TotalsBar({
  p,
  currency,
  label,
  options,
  dirty,
  saving,
  error,
  onSave,
}: {
  p: Preview;
  currency: string;
  label: string;
  options: { id: string; name: string; active: boolean }[];
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave?: () => void;
}) {
  return (
    <div className="totals-bar" role="region" aria-label="Totales del viaje">
      <div className="active">
        <small>Escenario activo</small>
        <strong>{label}</strong>
      </div>
      {p.ok ? (
        <dl>
          <div>
            <dt>Costo por estudiante</dt>
            <dd>{p.cost}</dd>
          </div>
          <div>
            <dt>% Comisión (utilidad)</dt>
            <dd className="hl">
              {p.pct}% ({p.marginEach})
            </dd>
          </div>
          <div className="main">
            <dt>Precio por estudiante</dt>
            <dd>
              {p.price} <small>{currency}</small>
            </dd>
          </div>
          <div>
            <dt>Total del grupo</dt>
            <dd>{p.group}</dd>
          </div>
          {p.mxn && (
            <div>
              <dt>Aprox. por estudiante</dt>
              <dd className="ok">{p.mxn} MXN</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="reason">{p.reason}</p>
      )}
      <div className="save">
        {options.length > 1 && (
          <nav aria-label="Opciones de la solicitud" className="options">
            {options.map((o) => (
              <Link key={o.id} href={`/cotizaciones/${o.id}`} aria-current={o.active ? 'page' : undefined}>
                {o.name}
              </Link>
            ))}
          </nav>
        )}
        {onSave && (
          <>
            {error ? (
              <span className="error" role="alert">
                {error}
              </span>
            ) : (
              <span className="muted">{dirty ? 'Cambios sin guardar' : 'Guardado'}</span>
            )}
            <button disabled={saving} onClick={onSave}>
              {saving ? 'Guardando…' : 'Guardar y calcular'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
