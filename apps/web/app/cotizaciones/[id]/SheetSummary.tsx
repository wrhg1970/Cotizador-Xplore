import { D } from '@ee/quote-engine';
import { type QuoteDto, SHEET_BLOCKS } from '../../lib/types';

const pct = (rate: string) => `${Number((Number(rate) * 100).toFixed(2))}%`;
/** "42828.00" → "42,828.00": thousands with commas, on the exact string (Will, 2026-11-10). */
export const thousands = (x: string) => x.replace(/^(-?\d+)/, (int) => int.replace(/\B(?=(\d{3})+$)/g, ','));
const n = thousands;

/** Saved figures laid out like Finance's EE sheet: concepts on the left, chaperones on the right. */
export function SheetSummary({ q }: { q: QuoteDto }) {
  const t = q.totals;
  const s = q.sheet;
  const cur = q.saleCurrency;
  if (!t || !s)
    return (
      <section className="card" aria-labelledby="hoja">
        <h2 id="hoja" style={{ marginTop: 0 }}>
          Hoja de cotización (guardada)
        </h2>
        <p className="muted">Sin totales hasta registrar los tipos de cambio que faltan.</p>
      </section>
    );
  // Line totals come from the server already converted and multiplied by headcount.
  // Read-only view: concepts at 0 are hidden (Will, 2026-11-06); subtotals and totals always show.
  const rows = (category: string) =>
    q.lines
      .map((l, i) => ({ l, total: t.lineTotals[i]! }))
      .filter(({ l, total }) => l.category === category && Number(total) !== 0)
      .map(({ l, total }, k) => (
        <tr key={`${category}-${k}`}>
          <td>
            {l.description}
            {l.internalOnly && <span className="muted"> (interno)</span>}
          </td>
          <td className="num">{n(total)}</td>
        </tr>
      ));
  const total = (label: string, value: string, strong = false) => (
    <tr className={strong ? 'total strong' : 'total'}>
      <th scope="row">{label}</th>
      <td className="num">{n(value)}</td>
    </tr>
  );
  const f = q.flight;
  const ft = f && t.flight;
  /** Avión summed into the course price (Sumar al curso Sí); apart, it keeps its own currency. */
  const fa = ft?.added ? ft : null;
  // Added, the rounding stays in the course price, so curso + avión = final price.
  const programMargin = fa ? new D(t.marginPerParticipant).minus(fa.marginPerParticipant) : null;
  const course = fa
    ? new D(t.pricePerParticipant).minus(fa.pricePerParticipant)
    : new D(t.pricePerParticipant);
  const mxn = (x: InstanceType<typeof D>) =>
    q.saleCurrency === 'MXN' ? null : q.mxnRate ? x.mul(q.mxnRate).toFixed(2) : null;
  const title = (c: string) => SHEET_BLOCKS.find((b) => b.category === c)!.title;

  return (
    <section className="card" aria-labelledby="hoja">
      <h2 id="hoja" style={{ marginTop: 0 }}>
        Hoja de cotización (guardada)
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {q.participants} estudiantes · {q.chaperones} chaperones de la escuela · {q.staff} chaperones EE ·
        cifras en {cur}
      </p>
      <div className="sheet sheet-3">
        <table aria-label="Conceptos por estudiante">
          <tbody>
            <tr>
              <th colSpan={2}>{title('PER_PARTICIPANT')}</th>
            </tr>
            {rows('PER_PARTICIPANT')}
            {total('SubTotal 1', t.directPerParticipant)}
            <tr>
              <td>Gastos del líder (total chaperones ÷ estudiantes)</td>
              <td className="num">{n(s.leaderPerParticipant)}</td>
            </tr>
            {Number(s.groupFixedTotal) > 0 && (
              <tr>
                <td>Fijos del grupo ÷ estudiantes</td>
                <td className="num">{n(s.groupFixedPerParticipant)}</td>
              </tr>
            )}
            {total('SubTotal 2', t.programCostPerParticipant)}
            <tr>
              <td>% Comisión (sobre el precio final)</td>
              <td className="num">{pct(q.targetMarginRate)}</td>
            </tr>
            <tr>
              <td>Comisión por estudiante · grupo</td>
              <td className="num">
                {programMargin
                  ? `${n(programMargin.toFixed(2))} · ${n(programMargin.mul(q.participants).toFixed(2))}`
                  : `${n(t.marginPerParticipant)} · ${n(t.groupMargin)}`}
              </td>
            </tr>
            {fa && (
              <>
                {total(
                  'Precio del curso',
                  new D(t.pricePerParticipant).minus(fa.pricePerParticipant).toFixed(2),
                )}
                <tr>
                  <td>
                    + Avión, precio final <span className="muted">(sin comisión)</span>
                  </td>
                  <td className="num">{n(fa.pricePerParticipant)}</td>
                </tr>
                <tr>
                  <td>Utilidad aérea por estudiante · grupo</td>
                  <td className="num">
                    {n(fa.marginPerParticipant)} ·{' '}
                    {n(new D(fa.marginPerParticipant).mul(q.participants).toFixed(2))}
                  </td>
                </tr>
              </>
            )}
            {total(`PRECIO FINAL (${cur})`, t.pricePerParticipant, true)}
            <tr>
              <td>Total del grupo</td>
              <td className="num">{n(t.groupPrice)}</td>
            </tr>
            {t.pricePerParticipantMxn && (
              <tr>
                <td>Estimado en pesos por estudiante</td>
                <td className="num">{n(t.pricePerParticipantMxn)} MXN</td>
              </tr>
            )}
            {t.groupMarginMxn && (
              <tr>
                <td>Comisión del grupo en pesos{fa && <span className="muted"> (incluye avión)</span>}</td>
                <td className="num">{n(t.groupMarginMxn)} MXN</td>
              </tr>
            )}
          </tbody>
        </table>
        <table aria-label="Gastos de chaperones">
          <tbody>
            <tr>
              <th colSpan={2}>Gastos de chaperones</th>
            </tr>
            <tr>
              <td>Chaperones de la escuela · EE</td>
              <td className="num">
                {q.chaperones} · {q.staff}
              </td>
            </tr>
            {rows('PER_STAFF')}
            {rows('PER_CHAPERONE')}
            {total('SubTotal chaperones', s.chaperonesTotal)}
            {Number(s.emergencyFund) !== 0 && (
              <tr>
                <td>{title('CONTINGENCY')}</td>
                <td className="num">{n(s.emergencyFund)}</td>
              </tr>
            )}
            {total('Total chaperones', s.totalChaperones, true)}
            {Number(s.groupFixedTotal) > 0 && (
              <>
                <tr>
                  <th colSpan={2}>{title('PER_GROUP')}</th>
                </tr>
                {rows('PER_GROUP')}
                {total('Total fijos del grupo', s.groupFixedTotal)}
              </>
            )}
          </tbody>
        </table>
        <div className="sheet-side">
          {f && ft && (
            <table aria-label="Avión">
              <tbody>
                <tr>
                  <th colSpan={2}>
                    ✈ Avión{' '}
                    <span className="muted">
                      {fa
                        ? f.currency !== cur && `· boleto en ${f.currency}`
                        : `· aparte del curso, en ${f.currency}`}
                    </span>
                  </th>
                </tr>
                <tr>
                  <td>Precio neto por boleto</td>
                  <td className="num">
                    {n(new D(f.netCost).toFixed(2))} {f.currency}
                  </td>
                </tr>
                <tr>
                  <td>
                    Boletos: {q.participants} est.{f.shareChaperones ? ` + ${q.chaperones} escuela` : ''}
                    {f.shareStaff ? ` + ${q.staff} EE` : ''}
                  </td>
                  <td className="num">{ft.tickets}</td>
                </tr>
                {total(`Costo aéreo del grupo${fa ? '' : ` (${f.currency})`}`, ft.groupCost)}
                <tr>
                  <td>Costo por estudiante (÷ {q.participants})</td>
                  <td className="num">{n(ft.costPerParticipant)}</td>
                </tr>
                <tr className="total strong">
                  <th scope="row">Precio final por estudiante</th>
                  <td className="num">
                    {fa
                      ? `${f.currency !== cur ? `${n(new D(f.finalPrice).toFixed(2))} ${f.currency} · ` : ''}${n(fa.pricePerParticipant)}`
                      : `${n(ft.pricePerParticipant)} ${f.currency}`}
                  </td>
                </tr>
                {!fa && (
                  <tr>
                    <td>Utilidad aérea por estudiante · grupo</td>
                    <td className="num">
                      {n(ft.marginPerParticipant)} ·{' '}
                      {n(new D(ft.marginPerParticipant).mul(q.participants).toFixed(2))} {f.currency}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {q.volumePrices && (
            <table aria-label="Precio por volumen">
              <tbody>
                <tr>
                  <th colSpan={2}>Precio por estudiante según tamaño del grupo</th>
                </tr>
                {q.volumePrices.map((p) => (
                  <tr key={p.participants}>
                    <td>{p.participants} estudiantes</td>
                    <td className="num">
                      {n(p.pricePerParticipant)} {q.saleCurrency}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} className="muted">
                    Mismos costos, chaperones y comisión; solo cambia entre cuántos se reparten los gastos de
                    chaperones y del grupo.
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
        <div className="group-total" role="group" aria-label="Precio por estudiante y total del grupo">
          <div className="group-total-top">
            <div>
              <span className="group-total-label">Precio por estudiante</span>
              <strong className="group-total-value">
                {n(t.pricePerParticipant)} {cur}
              </strong>
              {t.pricePerParticipantMxn && (
                <span className="group-total-mxn">≈ {n(t.pricePerParticipantMxn)} MXN</span>
              )}
            </div>
            {f && ft && (
              <div className="group-total-split">
                <div>
                  <small>Curso</small>
                  <strong>
                    {n(course.toFixed(2))} {cur}
                  </strong>
                  {mxn(course) && <span>≈ {n(mxn(course)!)} MXN</span>}
                </div>
                <div>
                  <small>✈ Avión{fa ? '' : ' (aparte)'}</small>
                  <strong>
                    {fa
                      ? `${n(fa.pricePerParticipant)} ${cur}`
                      : `${n(ft.pricePerParticipant)} ${f.currency}`}
                  </strong>
                  {fa ? (
                    <span>
                      {f.currency !== cur && `${n(new D(f.finalPrice).toFixed(2))} ${f.currency}`}
                      {f.currency !== cur && mxn(new D(fa.pricePerParticipant)) && ' · '}
                      {mxn(new D(fa.pricePerParticipant)) &&
                        `≈ ${n(mxn(new D(fa.pricePerParticipant))!)} MXN`}
                    </span>
                  ) : (
                    <span>no incluido en el precio del curso</span>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="group-total-foot">
            <div>
              <small>Total del grupo</small>
              <strong>
                {n(t.groupPrice)} {cur}
              </strong>
              <span>
                {n(t.pricePerParticipant)} {cur} × {q.participants} estudiantes
              </span>
            </div>
            <div>
              <small>Comisión del grupo</small>
              <strong>
                {n(t.groupMargin)} {cur}
              </strong>
              {t.groupMarginMxn && <span>≈ {n(t.groupMarginMxn)} MXN</span>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
