import { useState } from 'react';
import { atGroupSize, calculateQuote, D, freePlaces, type QuoteInput, safeDivide } from '@ee/quote-engine';
import { downloadCsv } from '../../lib/csv';
import type { QuoteDto } from '../../lib/types';

type Dec = InstanceType<typeof D>;
const n2 = (x: Dec) => x.toFixed(2);
// Same sizes as the server's volumePrices (VOLUME_SIZES), so the proposal shows these very prices.
const SIZES = [15, 20, 25, 30, 35] as const;

/** Chaperones, EE staff and emergency fund spread over n students: the sheet's "Gastos del líder". */
function at(input: QuoteInput, participants: number, studentsPerFreePlace?: number | null) {
  const sized = atGroupSize(input, participants, studentsPerFreePlace);
  const r = calculateQuote(sized);
  const b = r.byCategory;
  return {
    ...r,
    chaperones: sized.chaperones,
    leaderEach: safeDivide(b.PER_CHAPERONE.plus(b.PER_STAFF).plus(b.CONTINGENCY), new D(participants)),
  };
}

/** Stress test: fewer paying students or a moved exchange rate, with the price already given to the school. */
export function Sensitivity({ input, d }: { input: QuoteInput; d: QuoteDto }) {
  const base = d.participants;
  const [students, setStudents] = useState(base);
  const [fxDelta, setFxDelta] = useState(0);
  const cur = d.saleCurrency;
  const baseRate = cur === 'MXN' ? null : d.mxnRate ? Number(d.mxnRate) : null;
  const price = calculateQuote(input).pricePerParticipant;
  const now = at(input, students);
  const margin = price.minus(now.costPerParticipant);
  const rate = baseRate ? new D(baseRate).plus(fxDelta) : null;
  const sign = (x: number) => (x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2));

  return (
    <section className="card" aria-labelledby="sensibilidad">
      <p className="eyebrow">Simulador financiero de riesgo y sensibilidad</p>
      <h2 id="sensibilidad" style={{ margin: 0 }}>
        Variación de aforo y de tipo de cambio
      </h2>
      <p className="muted" style={{ margin: '4px 0 12px' }}>
        Qué pasa con los gastos de chaperones y la utilidad si se inscriben menos estudiantes o se mueve el
        tipo de cambio antes de pagar a proveedores. El precio se queda fijo; nada se guarda.
      </p>
      <div className="sim">
        <div className="sliders">
          <label>
            <span className="row" style={{ justifyContent: 'space-between' }}>
              Aforo real de estudiantes que pagan
              <strong>
                {students} (base {base})
              </strong>
            </span>
            <input
              type="range"
              min={5}
              max={40}
              value={students}
              onChange={(e) => setStudents(Number(e.target.value))}
            />
            <span className="scale">
              <span>Mín. 5</span>
              <span>Máx. 40</span>
            </span>
          </label>
          {baseRate && (
            <label>
              <span className="row" style={{ justifyContent: 'space-between' }}>
                Tipo de cambio {cur}/MXN
                <strong>
                  {(baseRate + fxDelta).toFixed(2)} ({sign(fxDelta)})
                </strong>
              </span>
              <input
                type="range"
                min={-2.5}
                max={3.5}
                step={0.05}
                value={fxDelta}
                onChange={(e) => setFxDelta(Number(e.target.value))}
              />
              <span className="scale">
                <span>−2.50</span>
                <span>Base {baseRate.toFixed(2)}</span>
                <span>+3.50</span>
              </span>
            </label>
          )}
        </div>
        <dl className="kpis">
          <div>
            <dt>Gastos del líder por estudiante</dt>
            <dd>
              {n2(now.leaderEach)} {cur}
            </dd>
          </div>
          <div>
            <dt>
              Margen real (precio fijo {n2(price)} {cur})
            </dt>
            <dd className={margin.isNegative() ? 'bad' : 'good'}>
              {price.isZero() ? '—' : `${margin.div(price).mul(100).toFixed(2)}%`}
            </dd>
            <small>
              Utilidad por estudiante: {n2(margin)} {cur}
            </small>
          </div>
          {rate && (
            <div>
              <dt>Precio por estudiante en pesos</dt>
              <dd>{n2(price.mul(rate))} MXN</dd>
              <small>Utilidad del grupo: {n2(margin.mul(students).mul(rate))} MXN</small>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}

/** V2 volume ladder: same costs and margin; chaperones grow with the free places earned. */
export function VolumeMatrix({
  input,
  d,
  editable,
  onFix,
  onShow,
  fileName,
}: {
  input: QuoteInput;
  d: QuoteDto;
  editable: boolean;
  onFix: (participants: number, chaperones: number) => void;
  onShow: (show: boolean) => void;
  fileName: string;
}) {
  const cur = d.saleCurrency;
  const mxn = cur === 'MXN' ? new D(1) : d.mxnRate ? new D(d.mxnRate) : null;
  const ratio = d.studentsPerFreePlace;
  const rows = SIZES.map((n, i) => {
    const r = at(input, n, ratio);
    const next = SIZES[i + 1];
    return {
      n,
      range: next ? `${n} a ${next - 1}` : `${n} o más`,
      active: d.participants >= n && (!next || d.participants < next),
      chaps: `${r.chaperones} escuela · ${d.staff} EE`,
      chaperones: r.chaperones,
      free: ratio ? freePlaces(n, ratio) : null,
      leader: r.leaderEach,
      price: r.pricePerParticipant,
      each: mxn && r.pricePerParticipant.mul(mxn),
      group: mxn && r.pricePerParticipant.mul(mxn).mul(n),
    };
  });

  return (
    <section className="card" aria-labelledby="volumen">
      <div className="section-head">
        <div>
          <p className="eyebrow">Matriz automática de precios por volumen de estudiantes</p>
          <h2 id="volumen" style={{ margin: 0 }}>
            Precio escalonado por rangos de aforo (15, 20, 25, 30 y 35+)
          </h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Mismos costos y % de comisión; cambia entre cuántos se reparten los gastos de chaperones y del
            grupo. Con lugares liberados, viaja un chaperón por cada lugar ganado (como en la V2).
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            downloadCsv(`${fileName}-precio-por-volumen.csv`, [
              [
                'Rango de aforo',
                'Estudiantes base',
                'Chaperones',
                'Lugares liberados',
                `Gasto líder prorrateado (${cur})`,
                `Precio final (${cur})`,
                ...(mxn ? ['Estimado por estudiante (MXN)', 'Total grupo (MXN)'] : []),
              ],
              ...rows.map((r) => [
                r.range,
                r.n,
                r.chaps,
                r.free ?? '',
                n2(r.leader),
                n2(r.price),
                ...(r.each && r.group ? [n2(r.each), n2(r.group)] : []),
              ]),
            ])
          }
        >
          Exportar tabla (Excel / CSV)
        </button>
      </div>
      <div className="table-wrap">
        <table aria-label="Precio por volumen" className="dark-head">
          <thead>
            <tr>
              <th>Rango de aforo</th>
              <th className="num">Estudiantes base</th>
              <th>Chaperones / lugares liberados{ratio ? ` (1:${ratio})` : ''}</th>
              <th className="num">Gasto líder prorrateado ({cur})</th>
              <th className="num">Precio final ({cur})</th>
              {mxn && <th className="num">Estimado / estudiante (MXN)</th>}
              {mxn && <th className="num">Total grupo (MXN)</th>}
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} className={r.active ? 'active' : undefined}>
                <td>
                  {r.range} {r.active && <span className="pill">Aforo activo</span>}
                </td>
                <td className="num">{r.n}</td>
                <td>
                  {r.chaps}
                  {r.free !== null && ` (${r.free} liberados)`}
                </td>
                <td className="num">{n2(r.leader)}</td>
                <td className="num strong">{n2(r.price)}</td>
                {r.each && <td className="num">{n2(r.each)}</td>}
                {r.group && <td className="num">{n2(r.group)}</td>}
                <td>
                  {r.active ? (
                    <span className="pill dark">Activo</span>
                  ) : editable ? (
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => onFix(r.n, r.chaperones)}
                    >
                      Fijar aforo
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="inline" style={{ marginTop: 10 }}>
        <input
          type="checkbox"
          checked={d.showVolumePrices}
          disabled={!editable}
          onChange={(e) => onShow(e.target.checked)}
        />{' '}
        Mostrar al colegio el precio por rango en la propuesta y en su liga (solo precios, sin costos)
      </label>
    </section>
  );
}
