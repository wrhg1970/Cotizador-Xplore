import { useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api';
import { MAX_BYTES, toBase64 } from './SheetImport';
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
  city = '',
}: {
  draft: QuoteDto;
  set: (patch: Partial<QuoteDto>) => void;
  /** The request's city, the first photo search. */
  city?: string;
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
      {sub === 'fotos' && <PhotoPicker draft={draft} set={set} city={city} />}
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

type Attachment = { id: string; fileName: string; mimeType: string; credit: string | null };
type StockPhoto = { id: number; thumb: string; alt: string; photographer: string; url: string };
const MAX_PHOTOS = 5;
/** Photos of versions made before there were several: their single cover. */
export const photosOf = (q: Pick<QuoteDto, 'photoIds' | 'coverAttachmentId'>) =>
  q.photoIds.length ? q.photoIds : q.coverAttachmentId ? [q.coverAttachmentId] : [];

/** Up to 5 destination photos: Pexels with one click, own uploads, or images already in the request's files. */
function PhotoPicker({
  draft,
  set,
  city,
}: {
  draft: QuoteDto;
  set: (patch: Partial<QuoteDto>) => void;
  city: string;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [query, setQuery] = useState(city);
  const [found, setFound] = useState<StockPhoto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/requests/${draft.requestId}/attachments`;
  const images = files.filter((a) => a.mimeType.startsWith('image/'));
  const chosen = photosOf(draft);
  const full = chosen.length >= MAX_PHOTOS;
  const choose = (ids: string[]) => set({ photoIds: ids, coverAttachmentId: ids[0] ?? null });
  const toggle = (id: string) =>
    choose(chosen.includes(id) ? chosen.filter((x) => x !== id) : full ? chosen : [...chosen, id]);
  const move = (i: number, by: number) => {
    const next = [...chosen];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    choose(next);
  };

  useEffect(() => {
    api<Attachment[]>(`/requests/${draft.requestId}/attachments`).then(setFiles, () => setFiles([]));
  }, [draft.requestId]);

  async function work(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const search = () =>
    work(async () => {
      const r = await api<{ photos: StockPhoto[] }>(`/stock-photos?q=${encodeURIComponent(query.trim())}`);
      setFound(r.photos);
    });
  const pickStock = (p: StockPhoto) => {
    const have = images.find((a) => a.fileName === `pexels-${p.id}.jpg`);
    if (have) return toggle(have.id);
    if (full) return;
    void work(async () => {
      const a = await api<Attachment>(`${base}/stock`, { method: 'POST', body: { photoId: p.id } });
      setFiles((all) => [...all, a]);
      choose([...chosen, a.id]);
    });
  };
  const uploadOwn = (list: FileList | null) =>
    work(async () => {
      const added: string[] = [];
      for (const file of Array.from(list ?? []).slice(0, MAX_PHOTOS - chosen.length)) {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} pesa más de 3 MB`);
        const a = await api<Attachment>(base, {
          method: 'POST',
          body: { fileName: file.name, fileBase64: await toBase64(file) },
        });
        setFiles((all) => [...all, a]);
        added.push(a.id);
      }
      choose([...chosen, ...added]);
    });
  const src = (id: string) => `/api/v1${base}/${id}`;
  const byId = new Map(images.map((a) => [a.id, a]));

  return (
    <section aria-labelledby="fotos">
      <h2 id="fotos">
        Fotos del destino{' '}
        <small className="muted">
          · máximo {MAX_PHOTOS} · la 1 es la portada · {chosen.length} de {MAX_PHOTOS}
        </small>
      </h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ol className="photo-row" aria-label="Fotos elegidas">
        {chosen.map((id, i) => (
          <li key={id} className="photo chosen">
            <img src={src(id)} alt={byId.get(id)?.fileName ?? `Foto ${i + 1}`} />
            <span className="photo-n">{i + 1}</span>
            <span className="photo-tools">
              <button
                type="button"
                aria-label={`Mover foto ${i + 1} antes`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`Mover foto ${i + 1} después`}
                disabled={i === chosen.length - 1}
                onClick={() => move(i, 1)}
              >
                →
              </button>
              <button type="button" aria-label={`Quitar foto ${i + 1}`} onClick={() => toggle(id)}>
                ✕
              </button>
            </span>
          </li>
        ))}
        {chosen.length === 0 && <li className="muted">Sin fotos: la propuesta sale sin portada.</li>}
      </ol>
      <div className="row photo-search">
        <input
          aria-label="Buscar fotos gratis"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (query.trim()) void search();
            }
          }}
        />
        <button type="button" disabled={busy || !query.trim()} onClick={() => void search()}>
          Buscar
        </button>
        <label className="button secondary">
          ⬆ Subir mis fotos
          <input
            type="file"
            accept="image/jpeg,image/png"
            multiple
            hidden
            disabled={busy || full}
            onChange={(e) => {
              void uploadOwn(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {found && (
        <>
          <ul className="photo-grid" aria-label="Fotos de Pexels">
            {found.map((p) => {
              const have = images.find((a) => a.fileName === `pexels-${p.id}.jpg`);
              const n = have ? chosen.indexOf(have.id) : -1;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="photo"
                    aria-pressed={n >= 0}
                    aria-label={`${p.alt || 'Foto'} · ${p.photographer}`}
                    disabled={busy || (n < 0 && full)}
                    onClick={() => pickStock(p)}
                  >
                    <img src={p.thumb} alt="" />
                    {n >= 0 && <span className="photo-n">{n + 1}</span>}
                    <small>Foto: {p.photographer}</small>
                  </button>
                </li>
              );
            })}
          </ul>
          {found.length === 0 && <p className="muted">Sin resultados; prueba otra palabra.</p>}
        </>
      )}
      {images.length > 0 && (
        <>
          <p className="muted">Fotos ya en los archivos de la solicitud:</p>
          <ul className="photo-grid small" aria-label="Fotos de la solicitud">
            {images.map((a) => {
              const n = chosen.indexOf(a.id);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className="photo"
                    aria-pressed={n >= 0}
                    aria-label={a.fileName}
                    disabled={n < 0 && full}
                    onClick={() => toggle(a.id)}
                  >
                    <img src={src(a.id)} alt="" />
                    {n >= 0 && <span className="photo-n">{n + 1}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="muted">
        Un clic agrega, otro clic quita. Fotos gratis de{' '}
        <a href="https://www.pexels.com" target="_blank" rel="noreferrer">
          Pexels
        </a>
        ; se guarda una copia y la propuesta da crédito al fotógrafo.
      </p>
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
