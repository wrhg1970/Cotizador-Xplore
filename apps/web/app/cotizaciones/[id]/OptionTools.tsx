import { useEffect, useState } from 'react';
import { freePlaces } from '@ee/quote-engine';
import type { LineCategory } from '@ee/contracts';
import { api, errorText } from '../../lib/api';
import {
  type ConceptTemplateDto,
  type QuoteDto,
  type QuoteLineDto,
  type QuoteTemplateDto,
  SHEET_BLOCKS,
  type SupplierDto,
} from '../../lib/types';
import type { Preview } from './LiveTotals';

type Set = (patch: Partial<QuoteDto>) => void;
const today = () => new Date().toISOString().slice(0, 10);

/** V2 quick loaders: an office template into this option, or a supplier's net rates as concepts. */
export function QuickLoad({
  draft,
  set,
  officeId,
  suppliers,
  onMargin,
  onNotice,
}: {
  draft: QuoteDto;
  set: Set;
  officeId: string;
  suppliers: SupplierDto[];
  onMargin: (rate: string) => void;
  onNotice: (text: string) => void;
}) {
  const [templates, setTemplates] = useState<QuoteTemplateDto[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  useEffect(() => {
    api<QuoteTemplateDto[]>(`/offices/${officeId}/quote-templates`).then(setTemplates, () =>
      setTemplates([]),
    );
  }, [officeId]);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const rates = supplier?.rates.filter((r) => r.active && (!r.validUntil || r.validUntil >= today())) ?? [];

  async function loadTemplate() {
    if (!window.confirm('Los conceptos de la plantilla reemplazan los de esta opción. ¿Continuar?')) return;
    try {
      const t = await api<{ name: string; targetMarginRate: string; lines: QuoteLineDto[] }>(
        `/quote-templates/${templateId}`,
      );
      set({ lines: t.lines.map((l) => ({ ...l, internalOnly: l.internalOnly ?? false })) });
      onMargin(t.targetMarginRate);
      onNotice(`Plantilla "${t.name}" cargada: revisa y pulsa “Guardar y calcular”.`);
    } catch (e) {
      onNotice(errorText(e));
    }
  }

  if (!templates.length && !suppliers.length) return null;
  return (
    <section className="card compact quick" aria-label="Plantillas y tarifario">
      {templates.length > 0 && (
        <div className="row">
          <label style={{ flex: 1 }}>
            Plantillas rápidas de destino
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Elige una plantilla…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.lineCount} conceptos · {t.saleCurrency})
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={!templateId} onClick={() => void loadTemplate()}>
            Cargar plantilla en {draft.scenarioName}
          </button>
        </div>
      )}
      {suppliers.length > 0 && (
        <div className="row">
          <label style={{ flex: 1 }}>
            Tarifario maestro de proveedores / DMC
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Elige un proveedor…</option>
              {suppliers
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.country ? ` · ${s.country}` : ''}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!rates.length}
            onClick={() => {
              set({
                lines: [
                  ...draft.lines,
                  ...rates.map((r) => ({
                    category: r.category,
                    description: r.description,
                    quantity: '1',
                    unitCost: r.unitCost,
                    currency: r.currency,
                    internalOnly: false,
                    costSource: supplier!.name,
                  })),
                ],
              });
              onNotice(`${rates.length} tarifas de ${supplier!.name} agregadas con su costo neto.`);
            }}
          >
            Inyectar costos netos{supplier ? ` (${rates.length})` : ''}
          </button>
        </div>
      )}
    </section>
  );
}

/** "1 lugar liberado por cada N": counted live; informative only, it never lowers the price (Will, 2026-10-27). */
export function FreePlaces({ draft, set, live }: { draft: QuoteDto; set: Set; live: Preview }) {
  const ratio = draft.studentsPerFreePlace;
  const count = ratio ? freePlaces(draft.participants, ratio) : 0;
  const missing = ratio ? ratio - (draft.participants % ratio) : 0;
  return (
    <section className="card compact" aria-labelledby="liberados">
      <h2 id="liberados">Lugares liberados (gratuidades por ratio)</h2>
      <div className="row">
        <label>
          1 lugar por cada (estudiantes)
          <input
            type="number"
            min={1}
            max={100}
            value={ratio ?? ''}
            placeholder="Sin lugares liberados"
            onChange={(e) =>
              set({
                studentsPerFreePlace: e.target.value ? Number(e.target.value) : null,
                freePlaceBenefit: e.target.value ? (draft.freePlaceBenefit ?? 'CHAPERONE') : null,
              })
            }
          />
        </label>
        {ratio && (
          <label>
            Destino del beneficio
            <select
              value={draft.freePlaceBenefit ?? 'CHAPERONE'}
              onChange={(e) => set({ freePlaceBenefit: e.target.value as 'CHAPERONE' | 'STUDENT' })}
            >
              <option value="CHAPERONE">Chaperón de la escuela</option>
              <option value="STUDENT">Beca para estudiante</option>
            </select>
          </label>
        )}
      </div>
      {ratio ? (
        <p>
          Con <strong>{draft.participants}</strong> estudiantes y ratio 1:{ratio}:{' '}
          <strong>
            {count} {count === 1 ? 'lugar liberado' : 'lugares liberados'}
          </strong>
          {live.ok &&
            count > 0 &&
            ` (equivale a ${(Number(live.price) * count).toFixed(2)} ${draft.saleCurrency})`}
          . Faltan {missing} estudiantes para el siguiente ({draft.participants + missing}).
        </p>
      ) : null}
      <p className="muted" style={{ margin: 0 }}>
        Se informa en la propuesta y no cambia el precio. El costo del chaperón ya está en su bloque.
      </p>
    </section>
  );
}

/** One-click frequent concepts from the catalog, or a custom one (optionally saved to the catalog by admins). */
export function NewConcept({
  draft,
  set,
  catalog,
  tripDays,
  canSaveToCatalog,
  onCatalog,
  onNotice,
}: {
  draft: QuoteDto;
  set: Set;
  catalog: ConceptTemplateDto[];
  tripDays: number | null;
  canSaveToCatalog: boolean;
  onCatalog: (c: ConceptTemplateDto) => void;
  onNotice: (text: string) => void;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<LineCategory>('PER_PARTICIPANT');
  const [save, setSave] = useState(false);
  const used = new Set(draft.lines.map((l) => `${l.category}|${l.description}`));
  const chips = catalog.filter((c) => c.active && !used.has(`${c.category}|${c.label}`)).slice(0, 10);
  const add = (label: string, cat: LineCategory, cost = '0', perDay = false, internalOnly = false) =>
    set({
      lines: [
        ...draft.lines,
        {
          category: cat,
          description: label,
          quantity: perDay && tripDays ? String(tripDays) : '1',
          unitCost: cost,
          currency: draft.saleCurrency,
          internalOnly,
        },
      ],
    });
  const block = (c: LineCategory) => SHEET_BLOCKS.find((b) => b.category === c)!.title;

  async function addCustom() {
    const label = name.trim();
    if (!label) return;
    add(label, category, amount.trim() || '0');
    setName('');
    setAmount('');
    if (!save) return;
    try {
      onCatalog(
        await api<ConceptTemplateDto>('/concept-templates', { method: 'POST', body: { label, category } }),
      );
      onNotice(`"${label}" agregado a la cotización y al catálogo de rubros.`);
    } catch (e) {
      onNotice(`Agregado a la cotización; no se guardó en el catálogo: ${errorText(e)}`);
    }
  }

  return (
    <section className="card compact" aria-labelledby="nuevo-rubro">
      <h2 id="nuevo-rubro">Integrar nuevo rubro</h2>
      {chips.length > 0 && (
        <>
          <p className="muted" style={{ margin: '0 0 6px' }}>
            Rubros del catálogo que aún no tiene esta opción (1 clic):
          </p>
          <div className="chips">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                className="secondary small"
                title={block(c.category)}
                onClick={() => add(c.label, c.category, '0', c.perTripDay, c.internalOnly)}
              >
                + {c.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <label style={{ flex: 2 }}>
          Rubro personalizado
          <input value={name} maxLength={300} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Costo ({draft.saleCurrency})
          <input inputMode="decimal" size={8} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Bloque
          <select value={category} onChange={(e) => setCategory(e.target.value as LineCategory)}>
            {SHEET_BLOCKS.map((b) => (
              <option key={b.category} value={b.category}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
        {canSaveToCatalog && (
          <label className="inline">
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Guardar en el
            catálogo
          </label>
        )}
        <button type="button" className="secondary" disabled={!name.trim()} onClick={() => void addCustom()}>
          Agregar rubro
        </button>
      </div>
    </section>
  );
}
