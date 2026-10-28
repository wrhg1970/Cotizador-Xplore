import { calculateQuote, D, dec, marginRateForPrice, QuoteEngineError, roundMoney } from '@ee/quote-engine';
import type { QuoteDto } from '../../lib/types';

const money = (x: InstanceType<typeof D>) => roundMoney(x, 2).toFixed(2);

export type Preview =
  | {
      ok: true;
      cost: string;
      price: string;
      group: string;
      margin: string;
      pct: string;
      mxn: string | null;
      lineTotals: string[];
      byCategory: Record<string, string>;
    }
  | { ok: false; reason: string };

/**
 * Unsaved figures with the same engine the API runs (packages/quote-engine), so the bar matches
 * "Guardar y calcular" to the cent. A typed final price derives the % like the server does.
 */
export function preview(d: QuoteDto, marginPct: string, targetPrice: string, byPrice: boolean): Preview {
  try {
    const input = {
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
      const rate = marginRateForPrice(r.costPerParticipant, new D(targetPrice.trim()));
      r = calculateQuote({ ...input, targetMarginRate: rate });
    }
    return {
      ok: true,
      cost: money(r.costPerParticipant),
      price: money(r.pricePerParticipant),
      group: money(r.groupPrice),
      margin: money(r.groupMargin),
      pct: r.pricePerParticipant.isZero()
        ? '0'
        : String(Number(r.marginPerParticipant.div(r.pricePerParticipant).mul(100).toFixed(2))),
      mxn: r.pricePerParticipantMxn && money(r.pricePerParticipantMxn),
      lineTotals: r.lineTotals.map(money),
      byCategory: Object.fromEntries(Object.entries(r.byCategory).map(([k, v]) => [k, money(v)])),
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

/** Always-visible footer of the editor: live totals, unsaved state and the save button. */
export function TotalsBar({
  p,
  currency,
  dirty,
  saving,
  error,
  onSave,
}: {
  p: Preview;
  currency: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  return (
    <div className="totals-bar" role="region" aria-label="Totales del viaje">
      {p.ok ? (
        <dl>
          <div>
            <dt>Costo por estudiante</dt>
            <dd>{p.cost}</dd>
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
          <div>
            <dt>Comisión del grupo ({p.pct}%)</dt>
            <dd>{p.margin}</dd>
          </div>
          {p.mxn && (
            <div>
              <dt>Aprox. por estudiante</dt>
              <dd>{p.mxn} MXN</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="reason">{p.reason}</p>
      )}
      <div className="save">
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
      </div>
    </div>
  );
}
