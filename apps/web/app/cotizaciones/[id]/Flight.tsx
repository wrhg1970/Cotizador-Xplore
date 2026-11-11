import { CurrencyCode } from '@ee/contracts';
import { D } from '@ee/quote-engine';
import type { FlightDto, QuoteDto } from '../../lib/types';
import type { Preview } from './LiveTotals';
import { thousands as n } from './SheetSummary';

const NEW_FLIGHT = (currency: CurrencyCode): FlightDto => ({
  netCost: '0',
  finalPrice: '0',
  currency,
  shareChaperones: true,
  shareStaff: true,
});

function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flight-share" role="group" aria-label={label}>
      <span>{label}</span>
      <span className="seg">
        <button type="button" aria-pressed={value} onClick={() => onChange(true)}>
          Sí
        </button>
        <button type="button" aria-pressed={!value} onClick={() => onChange(false)}>
          No
        </button>
      </span>
    </div>
  );
}

/** "Avión" tab of the sheet (Will, 2026-11-11): net ticket, who shares it and the final price per student. */
export function FlightPanel({
  draft,
  live,
  editable,
  onChange,
}: {
  draft: QuoteDto;
  live: Preview;
  editable: boolean;
  onChange: (flight: FlightDto | null) => void;
}) {
  const f = draft.flight;
  const cur = draft.saleCurrency;
  if (!f)
    return (
      <p className="muted">
        Esta cotización no lleva avión.{' '}
        {editable && (
          <button type="button" className="small" onClick={() => onChange(NEW_FLIGHT(cur))}>
            + Agregar avión
          </button>
        )}
      </p>
    );
  const set = (patch: Partial<FlightDto>) => onChange({ ...f, ...patch });
  const t = live.ok ? live.flight : null;
  return (
    <fieldset disabled={!editable} className="editor flight">
      <div className="fields">
        <label>
          Precio neto por boleto
          <input
            inputMode="decimal"
            value={f.netCost}
            onChange={(e) => set({ netCost: e.target.value.trim() })}
          />
        </label>
        <label>
          Moneda del boleto
          <select value={f.currency} onChange={(e) => set({ currency: e.target.value as CurrencyCode })}>
            {CurrencyCode.options.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <YesNo
          label={`Prorrateo chaperones escuela (${draft.chaperones})`}
          value={f.shareChaperones}
          onChange={(v) => set({ shareChaperones: v })}
        />
        <YesNo
          label={`Prorrateo chaperones EE (${draft.staff})`}
          value={f.shareStaff}
          onChange={(v) => set({ shareStaff: v })}
        />
        <label>
          Precio final por estudiante
          <input
            inputMode="decimal"
            value={f.finalPrice}
            onChange={(e) => set({ finalPrice: e.target.value.trim() })}
          />
        </label>
      </div>
      <p className="muted">
        Prorrateo Sí: sus boletos se reparten entre los estudiantes. No: no se cobran al grupo. El precio
        final se suma al precio por estudiante sin el % de comisión.
      </p>
      {t && live.ok && (
        <table className="flight-calc">
          <tbody>
            <tr>
              <td>
                Boletos: {draft.participants} estudiantes
                {f.shareChaperones ? ` + ${draft.chaperones} escuela` : ''}
                {f.shareStaff ? ` + ${draft.staff} EE` : ''}
              </td>
              <td className="num">{t.tickets}</td>
            </tr>
            <tr className="b">
              <td>Costo aéreo del grupo</td>
              <td className="num">
                {n(t.groupCost)} {cur}
              </td>
            </tr>
            <tr>
              <td>Costo por estudiante (÷ {draft.participants})</td>
              <td className="num">{n(t.cost)}</td>
            </tr>
            <tr>
              <td>Precio final por estudiante</td>
              <td className="num">{n(t.price)}</td>
            </tr>
            <tr className="accent">
              <td>Utilidad aérea por estudiante · grupo</td>
              <td className="num">
                {n(t.margin)} · {n(new D(t.margin).mul(draft.participants).toFixed(2))}
              </td>
            </tr>
            <tr>
              <td>Precio del curso (con % de comisión) + avión</td>
              <td className="num">
                {n(new D(live.price).minus(t.price).toFixed(2))} + {n(t.price)} = {n(live.price)} {cur}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {editable && (
        <button type="button" className="small" onClick={() => onChange(null)}>
          Quitar avión
        </button>
      )}
    </fieldset>
  );
}
