import { D, paymentSchedule, QuoteEngineError } from '@ee/quote-engine';
import { downloadCsv } from '../../lib/csv';
import { fmtDate, FREQUENCY_LABEL, type PaymentPlanDto, type QuoteDto } from '../../lib/types';
import type { Preview } from './LiveTotals';

const toPct = (rate: string) => String(Number((Number(rate) * 100).toFixed(4)));
const fromPct = (pct: string) => String(Number((Number(pct) / 100).toFixed(6)));
const today = () => new Date().toISOString().slice(0, 10);
const inAMonth = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const n2 = (x: InstanceType<typeof D>) => x.toFixed(2);

/** Live schedule from the unsaved price with the engine the server uses; null + reason when it can't. */
function liveSchedule(plan: PaymentPlanDto, price: string) {
  try {
    return {
      rows: paymentSchedule(new D(price), {
        ...plan,
        depositRate: plan.depositRate ? new D(plan.depositRate) : null,
        depositAmount: plan.depositAmount ? new D(plan.depositAmount) : null,
      }),
    };
  } catch (e) {
    if (!(e instanceof QuoteEngineError)) throw e;
    return { reason: e.message };
  }
}

/** V2 payment plan: registration, 1 to 15 installments as buttons, and the live table per student and group. */
export function PaymentPlan({
  draft,
  set,
  live,
  editable,
  fileName,
}: {
  draft: QuoteDto;
  set: (patch: Partial<QuoteDto>) => void;
  live: Preview;
  editable: boolean;
  fileName: string;
}) {
  const plan = draft.paymentPlan;
  const setPlan = (patch: Partial<PaymentPlanDto>) => plan && set({ paymentPlan: { ...plan, ...patch } });
  const deposit =
    plan?.depositAmount !== undefined ? 'amount' : plan?.depositRate !== undefined ? 'rate' : 'none';
  const cur = draft.saleCurrency;
  const mxn = cur === 'MXN' ? null : draft.mxnRate ? new D(draft.mxnRate) : null;
  const sched = plan && live.ok ? liveSchedule(plan, live.price) : null;
  const rows = sched && 'rows' in sched ? sched.rows : null;
  const count = rows?.filter((r) => r.number > 0).length ?? 0;
  const label = (n: number) =>
    n === 0
      ? 'Inscripción / apartado de lugar'
      : n === count
        ? `Pago ${n} de ${count} (liquidación)`
        : `Pago ${n} de ${count}`;
  const share = (x: InstanceType<typeof D>) =>
    live.ok && Number(live.price) > 0 ? `${x.div(live.price).mul(100).toFixed(2)}%` : '—';
  const group = (x: InstanceType<typeof D>) => x.mul(draft.participants);

  function exportCsv() {
    if (!rows || !live.ok) return;
    const head = ['No.', 'Concepto', 'Fecha límite', '% del total', `Por estudiante (${cur})`];
    if (mxn) head.push('Estimado por estudiante (MXN)');
    head.push(`Recaudación grupal (${draft.participants} est., ${cur})`);
    const line = (no: string, concept: string, date: string, amount: InstanceType<typeof D>) => [
      no,
      concept,
      date,
      share(amount),
      n2(amount),
      ...(mxn ? [n2(amount.mul(mxn))] : []),
      n2(group(amount)),
    ];
    const total = new D(live.price);
    downloadCsv(`${fileName}-plan-de-pagos.csv`, [
      head,
      ...rows.map((r) =>
        line(r.number ? `#${r.number}` : 'Inscripción', label(r.number), r.dueDate, r.amount),
      ),
      line('Total', `${rows.length} exhibiciones`, '', total),
    ]);
  }

  return (
    <section className="card" aria-labelledby="plan">
      <div className="section-head">
        <div>
          <p className="eyebrow">Calendario comercial y plan de cobranza por estudiante</p>
          <h2 id="plan" style={{ margin: 0 }}>
            Plan de pagos: inscripción y de 1 a 15 pagos
          </h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            El calendario guardado se integra en la propuesta del colegio.
          </p>
        </div>
        {rows && (
          <button type="button" className="secondary" onClick={exportCsv}>
            Exportar plan (Excel / CSV)
          </button>
        )}
      </div>
      <fieldset disabled={!editable} className="editor plain">
        <label className="inline">
          <input
            type="checkbox"
            checked={!!plan}
            onChange={(e) =>
              set({
                paymentPlan: e.target.checked
                  ? { installments: 6, frequency: 'MONTHLY', firstDueDate: inAMonth() }
                  : null,
              })
            }
          />{' '}
          Ofrecer plan de pagos (por estudiante, sobre el precio final)
        </label>
      </fieldset>
      {plan && (
        <>
          <fieldset disabled={!editable} className="editor plain">
            <div className="row" style={{ marginTop: 8 }}>
              <label>
                Inscripción
                <select
                  aria-label="Tipo de inscripción"
                  value={deposit}
                  onChange={(e) => {
                    const { depositRate: _r, depositAmount: _a, depositDueDate, ...rest } = plan;
                    const v = e.target.value;
                    set({
                      paymentPlan:
                        v === 'none'
                          ? rest
                          : {
                              ...rest,
                              depositDueDate: depositDueDate ?? today(),
                              ...(v === 'rate' ? { depositRate: '0.15' } : { depositAmount: '' }),
                            },
                    });
                  }}
                >
                  <option value="none">Sin inscripción</option>
                  <option value="rate">Porcentaje del precio</option>
                  <option value="amount">Monto fijo</option>
                </select>
              </label>
              {deposit === 'rate' && (
                <label>
                  Inscripción (%)
                  <input
                    type="number"
                    min={1}
                    max={99}
                    step="0.01"
                    value={toPct(plan.depositRate ?? '0')}
                    onChange={(e) => setPlan({ depositRate: fromPct(e.target.value) })}
                  />
                </label>
              )}
              {deposit === 'amount' && (
                <label>
                  Inscripción ({cur})
                  <input
                    inputMode="decimal"
                    value={plan.depositAmount ?? ''}
                    onChange={(e) => setPlan({ depositAmount: e.target.value.trim() })}
                  />
                </label>
              )}
              {deposit !== 'none' && (
                <label>
                  Fecha de inscripción
                  <input
                    type="date"
                    value={plan.depositDueDate ?? ''}
                    onChange={(e) => setPlan({ depositDueDate: e.target.value })}
                  />
                </label>
              )}
              <label>
                Frecuencia
                <select
                  value={plan.frequency}
                  onChange={(e) => setPlan({ frequency: e.target.value as PaymentPlanDto['frequency'] })}
                >
                  {Object.entries(FREQUENCY_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Primer pago
                <input
                  type="date"
                  value={plan.firstDueDate}
                  onChange={(e) => setPlan({ firstDueDate: e.target.value })}
                />
              </label>
            </div>
            <div className="section-head" style={{ marginTop: 12 }}>
              <span className="muted">Número de pagos parciales (de 1 a 15):</span>
              <span className="muted">
                Esquema: {deposit === 'none' ? '' : 'inscripción + '}
                {plan.installments} {plan.installments === 1 ? 'pago' : 'pagos'}
              </span>
            </div>
            <div className="picker" role="group" aria-label="Número de pagos">
              {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={plan.installments === n}
                  aria-label={`${n} ${n === 1 ? 'pago' : 'pagos'}`}
                  onClick={() => setPlan({ installments: n })}
                >
                  <strong>{n}</strong>
                  <small>{n === 1 ? 'pago' : 'pagos'}</small>
                </button>
              ))}
            </div>
          </fieldset>
          {sched && 'reason' in sched && <p className="error">Plan de pagos: {sched.reason}</p>}
          {!live.ok && <p className="muted">El calendario aparece en cuanto la hoja tenga precio.</p>}
          {rows && live.ok && (
            <div className="table-wrap">
              <table aria-label="Plan de pagos en vivo" className="dark-head">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Concepto</th>
                    <th>Fecha límite</th>
                    <th className="num">% del total</th>
                    <th className="num">Por estudiante ({cur})</th>
                    {mxn && <th className="num">Estimado por estudiante (MXN)</th>}
                    <th className="num">
                      Recaudación grupal ({draft.participants} est.{mxn ? ', MXN' : `, ${cur}`})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.number}>
                      <td>{r.number ? `#${r.number}` : 'Inscripción'}</td>
                      <td>{label(r.number)}</td>
                      <td>{fmtDate(r.dueDate)}</td>
                      <td className="num">{share(r.amount)}</td>
                      <td className="num">{n2(r.amount)}</td>
                      {mxn && <td className="num">{n2(r.amount.mul(mxn))}</td>}
                      <td className="num">{n2(mxn ? group(r.amount).mul(mxn) : group(r.amount))}</td>
                    </tr>
                  ))}
                  <tr className="total strong">
                    <td colSpan={3}>Total acumulado del plan ({rows.length} exhibiciones)</td>
                    <td className="num">100.00%</td>
                    <td className="num">{live.price}</td>
                    {mxn && <td className="num">{n2(new D(live.price).mul(mxn))}</td>}
                    <td className="num">
                      {n2(mxn ? group(new D(live.price)).mul(mxn) : group(new D(live.price)))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {mxn && (
            <p className="muted">Pesos aproximados al tipo de cambio de la cotización ({draft.mxnRate}).</p>
          )}
        </>
      )}
    </section>
  );
}
