import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, paymentLabel, type ProposalItemDto, type QuoteDto } from '../../lib/types';

const SUBTABS = [
  ['fotos', 'Fotos'],
  ['itinerario', 'Itinerario'],
  ['incluye', 'Incluye / No incluye'],
  ['supuestos', 'Supuestos'],
] as const;

/** Editable proposal extras in sub-tabs: photos, itinerary, Incluye / No incluye and assumptions. */
export function ProposalContent({
  draft,
  set,
}: {
  draft: QuoteDto;
  set: (patch: Partial<QuoteDto>) => void;
}) {
  const [sub, setSub] = useState<(typeof SUBTABS)[number][0]>('fotos');
  const itinerary = draft.itinerary ?? [];
  const setDay = (i: number, patch: Partial<(typeof itinerary)[number]>) =>
    set({ itinerary: itinerary.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  return (
    <>
      <div className="cfg-sub" role="group" aria-label="Secciones de la propuesta">
        {SUBTABS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={sub === k} onClick={() => setSub(k)}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'fotos' && <CoverPicker draft={draft} set={set} />}
      {sub === 'itinerario' && (
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
                <input
                  value={d.title}
                  maxLength={200}
                  onChange={(e) => setDay(i, { title: e.target.value })}
                />
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
                type="button"
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
            type="button"
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
      )}
      {sub === 'incluye' && <IncludesPicker draft={draft} set={set} />}
      {sub === 'supuestos' && (
        <section aria-labelledby="supuestos">
          <h2 id="supuestos">Supuestos</h2>
          <label>
            Supuestos y condiciones
            <textarea
              value={draft.assumptions ?? ''}
              maxLength={4000}
              onChange={(e) => set({ assumptions: e.target.value })}
            />
          </label>
        </section>
      )}
    </>
  );
}

/** What the proposal lists by itself: priced, client-visible per-student concepts (same rule as the API). */
const autoIncludes = (q: QuoteDto) =>
  q.lines
    .filter(
      (l) =>
        !l.internalOnly &&
        l.category === 'PER_PARTICIPANT' &&
        Number(l.unitCost) > 0 &&
        Number(l.quantity) > 0,
    )
    .map((l) => l.description)
    .concat(q.flight?.addToCourse ? ['Boleto de avión'] : []);

/** Incluye / No incluye: one click on a catalog phrase, or "+ Otro" for a one-off. */
function IncludesPicker({ draft, set }: { draft: QuoteDto; set: (patch: Partial<QuoteDto>) => void }) {
  const [catalog, setCatalog] = useState<ProposalItemDto[]>([]);
  useEffect(() => {
    api<ProposalItemDto[]>('/proposal-items').then(
      (all) => setCatalog(all.filter((i) => i.active)),
      () => setCatalog([]),
    );
  }, []);
  const auto = autoIncludes(draft);
  return (
    <>
      <PhraseGroup
        title="Incluye"
        help="En azul claro, los que salen solos de los conceptos con precio. Agrega más del catálogo:"
        fixed={auto}
        options={catalog.filter((i) => !i.excluded).map((i) => i.label)}
        picked={draft.extraIncludes}
        onChange={(extraIncludes) => set({ extraIncludes })}
      />
      <PhraseGroup
        title="No incluye"
        options={catalog.filter((i) => i.excluded).map((i) => i.label)}
        picked={draft.exclusions}
        onChange={(exclusions) => set({ exclusions })}
      />
      <p className="muted">
        Un clic agrega, otro clic quita. El catálogo se edita en Configuración → Incluye / No incluye.
      </p>
    </>
  );
}

function PhraseGroup({
  title,
  help,
  fixed = [],
  options,
  picked,
  onChange,
}: {
  title: string;
  help?: string;
  fixed?: string[];
  options: string[];
  picked: string[];
  onChange: (next: string[]) => void;
}) {
  const [other, setOther] = useState('');
  const shown = [...options, ...picked.filter((p) => !options.includes(p))].filter((p) => !fixed.includes(p));
  const toggle = (p: string) => onChange(picked.includes(p) ? picked.filter((x) => x !== p) : [...picked, p]);
  const addOther = () => {
    const p = other.trim();
    if (p && !picked.includes(p) && !fixed.includes(p)) onChange([...picked, p]);
    setOther('');
  };
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      {fixed.length > 0 && (
        <div className="pick-list">
          {fixed.map((p) => (
            <span key={p} className="pick fixed">
              ✓ {p}
            </span>
          ))}
        </div>
      )}
      {help && <p className="muted">{help}</p>}
      <div className="pick-list">
        {shown.map((p) => (
          <button
            key={p}
            type="button"
            className={title === 'No incluye' ? 'pick out' : 'pick'}
            aria-pressed={picked.includes(p)}
            onClick={() => toggle(p)}
          >
            {picked.includes(p) ? (title === 'No incluye' ? '✕ ' : '✓ ') : ''}
            {p}
          </button>
        ))}
        <input
          className="pick-other"
          aria-label={`Otro concepto: ${title}`}
          placeholder="+ Otro…"
          maxLength={300}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addOther();
            }
          }}
          onBlur={addOther}
        />
      </div>
    </section>
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
