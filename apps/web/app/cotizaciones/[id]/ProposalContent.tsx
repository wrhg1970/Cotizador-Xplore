import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, paymentLabel, type QuoteDto } from '../../lib/types';

/** Editable proposal extras: cover, itinerary and exclusions (plan and free places have their own panels). */
export function ProposalContent({
  draft,
  set,
}: {
  draft: QuoteDto;
  set: (patch: Partial<QuoteDto>) => void;
}) {
  const itinerary = draft.itinerary ?? [];
  const setDay = (i: number, patch: Partial<(typeof itinerary)[number]>) =>
    set({ itinerary: itinerary.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  return (
    <>
      <CoverPicker draft={draft} set={set} />
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
