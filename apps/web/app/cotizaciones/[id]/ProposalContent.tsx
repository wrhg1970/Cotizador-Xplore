import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, FREQUENCY_LABEL, paymentLabel, type PaymentPlanDto, type QuoteDto } from '../../lib/types';

const toPct = (rate: string) => String(Number((Number(rate) * 100).toFixed(4)));
const fromPct = (pct: string) => String(Number((Number(pct) / 100).toFixed(6)));
const today = () => new Date().toISOString().slice(0, 10);
const inAMonth = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

/** Editable proposal extras: payment plan, free places, itinerary and exclusions (Sprint B). */
export function ProposalContent({
  draft,
  set,
}: {
  draft: QuoteDto;
  set: (patch: Partial<QuoteDto>) => void;
}) {
  const plan = draft.paymentPlan;
  const setPlan = (patch: Partial<PaymentPlanDto>) => plan && set({ paymentPlan: { ...plan, ...patch } });
  const deposit =
    plan?.depositAmount !== undefined ? 'amount' : plan?.depositRate !== undefined ? 'rate' : 'none';
  const itinerary = draft.itinerary ?? [];
  const setDay = (i: number, patch: Partial<(typeof itinerary)[number]>) =>
    set({ itinerary: itinerary.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  return (
    <>
      <CoverPicker draft={draft} set={set} />
      <section aria-labelledby="plan">
        <h2 id="plan">Plan de pagos</h2>
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
        {plan && (
          <div className="row">
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
                Inscripción ({draft.saleCurrency})
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
              Parcialidades
              <input
                type="number"
                min={1}
                max={15}
                value={plan.installments}
                onChange={(e) => setPlan({ installments: Number(e.target.value) })}
              />
            </label>
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
        )}
      </section>

      <section aria-labelledby="liberados">
        <h2 id="liberados">Lugares liberados</h2>
        <div className="row">
          <label>
            1 lugar por cada (estudiantes)
            <input
              type="number"
              min={1}
              max={100}
              value={draft.studentsPerFreePlace ?? ''}
              placeholder="Sin lugares liberados"
              onChange={(e) =>
                set({
                  studentsPerFreePlace: e.target.value ? Number(e.target.value) : null,
                  freePlaceBenefit: e.target.value ? (draft.freePlaceBenefit ?? 'CHAPERONE') : null,
                })
              }
            />
          </label>
          {draft.studentsPerFreePlace && (
            <label>
              Para
              <select
                value={draft.freePlaceBenefit ?? 'CHAPERONE'}
                onChange={(e) => set({ freePlaceBenefit: e.target.value as 'CHAPERONE' | 'STUDENT' })}
              >
                <option value="CHAPERONE">Chaperón</option>
                <option value="STUDENT">Beca para estudiante</option>
              </select>
            </label>
          )}
        </div>
        <p className="muted">
          Se informa en la propuesta; todavía no cambia el precio. El costo del chaperón ya está en el bloque
          de chaperones.
        </p>
      </section>

      <section aria-labelledby="itinerario">
        <h2 id="itinerario">Itinerario</h2>
        {itinerary.map((d, i) => (
          <div className="row" key={i}>
            <label>
              Día
              <input
                type="number"
                min={1}
                max={366}
                size={4}
                value={d.day}
                onChange={(e) => setDay(i, { day: Number(e.target.value) })}
              />
            </label>
            <label style={{ flex: 1 }}>
              Título
              <input value={d.title} maxLength={200} onChange={(e) => setDay(i, { title: e.target.value })} />
            </label>
            <label style={{ flex: 2 }}>
              Detalle
              <input
                value={d.details ?? ''}
                maxLength={2000}
                onChange={(e) => setDay(i, { details: e.target.value })}
              />
            </label>
            <button
              className="secondary"
              aria-label={`Quitar día ${d.day}`}
              onClick={() => {
                const rest = itinerary.filter((_, j) => j !== i);
                set({ itinerary: rest.length ? rest : null });
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="secondary"
          onClick={() =>
            set({
              itinerary: [...itinerary, { day: (itinerary.at(-1)?.day ?? 0) + 1, title: '', details: '' }],
            })
          }
        >
          Agregar día
        </button>
      </section>

      <section aria-labelledby="noincluye">
        <h2 id="noincluye">No incluye</h2>
        <label>
          Un concepto por línea
          <textarea
            value={draft.exclusions.join('\n')}
            onChange={(e) => set({ exclusions: e.target.value.split('\n') })}
          />
        </label>
      </section>
    </>
  );
}

/** Destination photo for the proposal, chosen among the request's JPG/PNG attachments. */
function CoverPicker({ draft, set }: { draft: QuoteDto; set: (patch: Partial<QuoteDto>) => void }) {
  const [images, setImages] = useState<{ id: string; fileName: string }[]>([]);
  useEffect(() => {
    api<{ id: string; fileName: string; mimeType: string }[]>(
      `/requests/${draft.requestId}/attachments`,
    ).then(
      (all) => setImages(all.filter((a) => a.mimeType.startsWith('image/'))),
      () => setImages([]),
    );
  }, [draft.requestId]);
  return (
    <section aria-labelledby="portada">
      <h2 id="portada">Foto del destino</h2>
      {images.length ? (
        <label>
          Portada de la propuesta
          <select
            value={draft.coverAttachmentId ?? ''}
            onChange={(e) => set({ coverAttachmentId: e.target.value || null })}
          >
            <option value="">Sin foto</option>
            {images.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fileName}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="muted">
          Sube una foto JPG o PNG en los adjuntos de la solicitud para usarla de portada.
        </p>
      )}
    </section>
  );
}

/** Saved schedule, per student, as the client will see it. */
export function PaymentSchedule({ q }: { q: Pick<QuoteDto, 'paymentSchedule'> & { saleCurrency: string } }) {
  const ps = q.paymentSchedule;
  if (!ps) return null;
  const count = ps.filter((p) => p.number > 0).length;
  return (
    <table aria-label="Plan de pagos por estudiante">
      <thead>
        <tr>
          <th>Pago</th>
          <th>Fecha límite</th>
          <th className="num">Monto ({q.saleCurrency})</th>
        </tr>
      </thead>
      <tbody>
        {ps.map((p) => (
          <tr key={p.number}>
            <td>{paymentLabel(p, count)}</td>
            <td>{fmtDate(p.dueDate)}</td>
            <td className="num">{p.amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
