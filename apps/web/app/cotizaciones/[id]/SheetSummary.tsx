import { type QuoteDto, SHEET_BLOCKS } from '../../lib/types';

const pct = (rate: string) => `${Number((Number(rate) * 100).toFixed(2))}%`;

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
  const rows = (category: string) =>
    q.lines
      .map((l, i) => ({ l, total: t.lineTotals[i]! }))
      .filter(({ l }) => l.category === category)
      .map(({ l, total }, k) => (
        <tr key={`${category}-${k}`}>
          <td>
            {l.description}
            {l.internalOnly && <span className="muted"> (interno)</span>}
          </td>
          <td className="num">{total}</td>
        </tr>
      ));
  const total = (label: string, value: string, strong = false) => (
    <tr className={strong ? 'total strong' : 'total'}>
      <th scope="row">{label}</th>
      <td className="num">{value}</td>
    </tr>
  );
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
      <div className="sheet">
        <table aria-label="Conceptos por estudiante">
          <tbody>
            <tr>
              <th colSpan={2}>{title('PER_PARTICIPANT')}</th>
            </tr>
            {rows('PER_PARTICIPANT')}
            {total('SubTotal 1', t.directPerParticipant)}
            <tr>
              <td>Gastos del líder (total chaperones ÷ estudiantes)</td>
              <td className="num">{s.leaderPerParticipant}</td>
            </tr>
            {Number(s.groupFixedTotal) > 0 && (
              <tr>
                <td>Fijos del grupo ÷ estudiantes</td>
                <td className="num">{s.groupFixedPerParticipant}</td>
              </tr>
            )}
            {total('SubTotal 2', t.costPerParticipant)}
            <tr>
              <td>% Comisión (sobre el precio final)</td>
              <td className="num">{pct(q.targetMarginRate)}</td>
            </tr>
            <tr>
              <td>Comisión por estudiante · grupo</td>
              <td className="num">
                {t.marginPerParticipant} · {t.groupMargin}
              </td>
            </tr>
            {total(`PRECIO FINAL (${cur})`, t.pricePerParticipant, true)}
            <tr>
              <td>Total del grupo</td>
              <td className="num">{t.groupPrice}</td>
            </tr>
            {t.pricePerParticipantMxn && (
              <tr>
                <td>Estimado en pesos por estudiante</td>
                <td className="num">{t.pricePerParticipantMxn} MXN</td>
              </tr>
            )}
            {t.groupMarginMxn && (
              <tr>
                <td>Comisión del grupo en pesos</td>
                <td className="num">{t.groupMarginMxn} MXN</td>
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
            <tr>
              <td>{title('CONTINGENCY')}</td>
              <td className="num">{s.emergencyFund}</td>
            </tr>
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
      </div>
    </section>
  );
}
