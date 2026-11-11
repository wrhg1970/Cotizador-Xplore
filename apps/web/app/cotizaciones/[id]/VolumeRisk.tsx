import { useState } from 'react';
import { atGroupSize, calculateQuote, D, freePlaces, type QuoteInput, safeDivide } from '@ee/quote-engine';
import { downloadCsv } from '../../lib/csv';
import type { QuoteDto } from '../../lib/types';
import { thousands } from './SheetSummary';

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

/** Stress test: fewer paying students or another % de comisión; the price follows, like the sheet. */
export function Sensitivity({ input, d }: { input: QuoteInput; d: QuoteDto }) {
  const base = d.participants;
  // Exact %, so the simulator starts on today's price; the slider then moves in 0.5 steps.
  const basePct = input.targetMarginRate.mul(100).toNumber();
  // null = follow the scenario's own value while it is still being edited.
  const [studentsSet, setStudents] = useState<number | null>(null);
  const [pctSet, setPct] = useState<number | null>(null);
  const students = studentsSet ?? base;
  const pct = pctSet ?? basePct;
  const cur = d.saleCurrency;
  const rate = cur !== 'MXN' && d.mxnRate ? new D(d.mxnRate) : null;
  const price = calculateQuote(input).pricePerParticipant;
  const now = at({ ...input, targetMarginRate: new D(pct).div(100) }, students);
  const diff = now.pricePerParticipant.minus(price);
  const m = (x: Dec) => thousands(n2(x));
  const mxn = (x: Dec) => rate && <small>≈ {m(x.mul(rate))} MXN</small>;

  return (
    <section className="card" aria-labelledby="sensibilidad">
      <p className="eyebrow">Simulador financiero de riesgo y sensibilidad</p>
      <h2 id="sensibilidad" style={{ margin: 0 }}>
        Variación de aforo y de % de comisión
      </h2>
      <p className="muted" style={{ margin: '4px 0 12px' }}>
        Qué pasa con el precio por estudiante y la comisión si se inscriben menos estudiantes o se ajusta el %
        de comisión. Nada se guarda.
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
          <label>
            <span className="row" style={{ justifyContent: 'space-between' }}>
              % de comisión
              <strong>
                {pct.toFixed(1)}% (base {basePct.toFixed(1)}%)
              </strong>
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(40, Math.ceil(basePct))}
              step={0.5}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
            />
            <span className="scale">
              <span>0%</span>
              <span>Base {basePct.toFixed(1)}%</span>
              <span>{Math.max(40, Math.ceil(basePct))}%</span>
            </span>
          </label>
        </div>
        <dl className="kpis">
          <div>
            <dt>Precio por estudiante</dt>
            <dd>
              {m(now.pricePerParticipant)} {cur}
            </dd>
            {mxn(now.pricePerParticipant)}
            <small style={{ display: 'block' }}>
              {diff.isZero()
                ? 'Igual al precio actual'
                : `${diff.isPositive() ? '+' : '−'}${m(diff.abs())} ${cur} vs precio actual (${m(price)})`}
            </small>
          </div>
          <div>
            <dt>Comisión por estudiante</dt>
            <dd className={now.marginPerParticipant.isNegative() ? 'bad' : undefined}>
              {m(now.marginPerParticipant)} {cur}
            </dd>
            <small style={{ display: 'block' }}>
              Comisión del grupo: {m(now.groupMargin)} {cur}
            </small>
            {mxn(now.groupMargin)}
          </div>
          <div>
            <dt>Gastos del líder por estudiante</dt>
            <dd>
              {m(now.leaderEach)} {cur}
            </dd>
            <small>Chaperones, staff EE y fondo de emergencia</small>
          </div>
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
            grupo. Con gratuidades por ratio, viaja un chaperón por cada gratuidad ganada (como en la V2); la
            gratuidad solo descuenta su curso.
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
                'Gratuidades por ratio',
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
              <th>Chaperones / gratuidades{ratio ? ` (1:${ratio})` : ''}</th>
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
                  {r.free !== null && ` (${r.free} ${r.free === 1 ? 'gratuidad' : 'gratuidades'})`}
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
