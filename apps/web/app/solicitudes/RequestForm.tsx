'use client';

import { CurrencyCode, type RequestDraft, type TripSpecs } from '@ee/contracts';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { MAX_BYTES, toBase64 } from '../cotizaciones/[id]/SheetImport';
import { api, errorText } from '../lib/api';
import { fmtDate, PRIORITY_LABEL, type TravelRequestDto } from '../lib/types';
import { useMe } from '../lib/useMe';
import s from './RequestForm.module.css';

interface Office {
  id: string;
  code: string;
  name: string;
}
interface Country {
  code: string;
  name: string;
}
interface Extra {
  name: string;
  value: string;
}

const STEPS = ['Información general', 'Especificaciones del programa', 'Confirmación y registro'];
const PROGRAM_TYPES = [
  'Inmersión académica',
  'Viaje cultural',
  'Campamento de verano',
  'Intercambio',
  'Viaje de graduación',
  'Deportivo',
  'Voluntariado',
];
/** Free-text spec blocks shown in step 2; included / notIncluded / extra are edited as lists. */
const SPEC_FIELDS: { key: keyof TripSpecs; label: string; placeholder: string }[] = [
  {
    key: 'accommodation',
    label: 'Tipo de alojamiento',
    placeholder: 'Ej. Residencia en campus, habitación doble',
  },
  {
    key: 'receivingSchool',
    label: 'Escuela, universidad o proveedor receptor',
    placeholder: 'Ej. University of Toronto',
  },
  {
    key: 'courses',
    label: 'Cursos, talleres o actividades académicas',
    placeholder: 'Ej. 20 lecciones semanales',
  },
  { key: 'meals', label: 'Plan de alimentación', placeholder: 'Ej. Pensión completa' },
  {
    key: 'transfersMeals',
    label: 'Traslados y transporte local',
    placeholder: 'Ej. Aeropuerto–campus–aeropuerto',
  },
  {
    key: 'flightsExcursions',
    label: 'Vuelos, visitas y excursiones',
    placeholder: 'Ej. Museos y recorrido cultural',
  },
  {
    key: 'insuranceAccessibility',
    label: 'Seguro y accesibilidad',
    placeholder: 'Ej. Seguro médico internacional',
  },
];

const optional = (v: FormDataEntryValue | null) => {
  const t = String(v ?? '').trim();
  return t === '' ? undefined : t;
};
const lines = (t?: string | null) =>
  t
    ? t
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
const parseExtras = (t?: string | null): Extra[] =>
  lines(t).map((l) => {
    const i = l.indexOf(':');
    return i < 0 ? { name: l, value: '' } : { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
  });

/** Only the filled blocks; null when every block is empty, so the request carries no empty object. */
function specsFrom(f: FormData, included: string[], excluded: string[], extras: Extra[]) {
  const filled: [keyof TripSpecs, string][] = SPEC_FIELDS.flatMap(({ key }) => {
    const v = optional(f.get(`spec_${key}`));
    return v ? [[key, v] as [keyof TripSpecs, string]] : [];
  });
  if (included.length) filled.push(['included', included.join('\n')]);
  if (excluded.length) filled.push(['notIncluded', excluded.join('\n')]);
  if (extras.length) filled.push(['extra', extras.map((e) => `${e.name}: ${e.value}`).join('\n')]);
  return filled.length ? (Object.fromEntries(filled) as TripSpecs) : null;
}

/** Input + "Agregar" + removable rows; Enter adds instead of submitting. */
function ListEditor({
  title,
  placeholder,
  items,
  onChange,
}: {
  title: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (t && !items.includes(t)) onChange([...items, t]);
    setText('');
  };
  return (
    <div className={s.list}>
      <h3 className={s.subhead}>{title}</h3>
      <div className={s.addRow}>
        <input
          aria-label={`Agregar a ${title.toLowerCase()}`}
          placeholder={placeholder}
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className={s.dark} onClick={add}>
          Agregar
        </button>
      </div>
      <ul className={s.items}>
        {items.map((it) => (
          <li key={it}>
            <span>{it}</span>
            <button
              type="button"
              className={s.remove}
              aria-label={`Quitar ${it}`}
              onClick={() => onChange(items.filter((x) => x !== it))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Create (optionally prefilled from an imported `draft`) or edit, in three steps like the V2 model.
 * "Guardar borrador" saves at any step and keeps the wizard open; the server re-validates everything.
 */
export function RequestForm({ existing, draft }: { existing?: TravelRequestDto; draft?: RequestDraft }) {
  const router = useRouter();
  const me = useMe();
  const init = existing ?? draft;
  const formRef = useRef<HTMLFormElement>(null);
  const panes = useRef<(HTMLDivElement | null)[]>([]);
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<TravelRequestDto | undefined>(existing);
  const [offices, setOffices] = useState<Office[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [included, setIncluded] = useState(() => lines(init?.specifications?.included));
  const [excluded, setExcluded] = useState(() => lines(init?.specifications?.notIncluded));
  const [extras, setExtras] = useState(() => parseExtras(init?.specifications?.extra));
  const [extra, setExtra] = useState<Extra>({ name: '', value: '' });
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const basis = existing?.budget?.basis ?? 'PER_PARTICIPANT';

  useEffect(() => {
    api<Office[]>('/offices').then(setOffices, () => undefined);
    api<Country[]>('/catalogs/countries').then(setCountries, () => undefined);
  }, []);

  /** Native validation of one step; focuses that step on the first invalid field. */
  function valid(i: number): boolean {
    const bad = Array.from(panes.current[i]?.querySelectorAll('input, select, textarea') ?? []).find(
      (el) => !(el as HTMLInputElement).checkValidity(),
    ) as HTMLInputElement | undefined;
    if (!bad) {
      const f = new FormData(formRef.current!);
      const dep = String(f.get('departureDate') ?? '');
      const ret = String(f.get('returnDate') ?? '');
      if (i === 0 && dep && ret && ret < dep) {
        setError('El regreso no puede ser anterior a la salida');
        setStep(0);
        return false;
      }
      return true;
    }
    setStep(i);
    // The pane must be visible before the browser can show its bubble.
    setTimeout(() => bad.reportValidity());
    return false;
  }

  function goTo(i: number) {
    setError(null);
    for (let j = 0; j < i; j++) if (!valid(j)) return;
    if (i === 2) setSummary(Object.fromEntries(new FormData(formRef.current!)) as Record<string, string>);
    setStep(i);
  }

  function payload() {
    const f = new FormData(formRef.current!);
    const amount = optional(f.get('budgetAmount'));
    return {
      groupName: String(f.get('groupName')).trim(),
      clientName: optional(f.get('clientName')),
      contactName: optional(f.get('contactName')),
      contactEmail: optional(f.get('contactEmail')),
      program: optional(f.get('program')),
      city: String(f.get('city')).trim(),
      countryCode: String(f.get('countryCode')),
      departureDate: String(f.get('departureDate')),
      returnDate: String(f.get('returnDate')),
      participants: Number(f.get('participants')),
      chaperones: Number(f.get('chaperones') || 0),
      staff: Number(f.get('staff') || 0),
      budget: amount ? { amount, currency: String(f.get('budgetCurrency')), basis } : null,
      requirements: optional(f.get('requirements')),
      commercialNotes: optional(f.get('commercialNotes')),
      specifications: specsFrom(f, included, excluded, extras),
      priority: String(f.get('priority')),
      dueDate: optional(f.get('dueDate')),
      officeId: String(f.get('officeId')),
    };
  }

  /** Creates the draft the first time (folio assigned), then patches it; uploads a pending file. */
  async function persist(): Promise<TravelRequestDto> {
    const { officeId, ...fields } = payload();
    const row = saved
      ? await api<TravelRequestDto>(`/requests/${saved.id}`, {
          method: 'PATCH',
          body: { ...fields, version: saved.version },
        })
      : await api<TravelRequestDto>('/requests', { method: 'POST', body: { ...fields, officeId } });
    setSaved(row);
    if (file) {
      await api(`/requests/${row.id}/attachments`, {
        method: 'POST',
        body: { fileName: file.name, fileBase64: await toBase64(file) },
      });
      setFile(null);
    }
    return row;
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    setNotice(null);
    if (!valid(0)) return;
    setSaving(true);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const saveDraft = () =>
    run(async () => {
      const row = await persist();
      setNotice(`Guardado · ${row.folio}`);
    });

  const register = () =>
    run(async () => {
      if (!valid(1)) return;
      let row = await persist();
      if (row.status === 'DRAFT')
        row = await api<TravelRequestDto>(`/requests/${row.id}/submit`, {
          method: 'POST',
          body: { version: row.version },
        });
      router.push(`/solicitudes/${row.id}`);
    });

  const isDraft = !saved || saved.status === 'DRAFT';
  const folio = saved?.folio;
  const officeName = offices.find((o) => o.id === summary.officeId)?.name ?? saved?.office.name;
  const countryName = countries.find((c) => c.code === summary.countryCode)?.name ?? summary.countryCode;
  const v = (k: string) => summary[k]?.trim() || '—';

  return (
    <form ref={formRef} className={s.wizard} noValidate onSubmit={(e) => e.preventDefault()}>
      <header className={s.head}>
        <h1>{existing ? 'Editar solicitud' : 'Nueva solicitud de cotización grupal'}</h1>
        <p>
          Folio: {folio ?? 'se asigna al guardar'} · Responsable: {saved?.requester.name ?? me?.name ?? '…'}
        </p>
      </header>

      <div role="tablist" aria-label="Pasos de la solicitud" className={s.tabs}>
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={step === i}
            className={s.tab}
            onClick={() => goTo(i)}
          >
            <b>{String(i + 1).padStart(2, '0')}</b> {label}
          </button>
        ))}
      </div>

      <div className={s.body}>
        <div ref={(el) => void (panes.current[0] = el)} hidden={step !== 0} className={s.grid3}>
          <label>
            Nombre del grupo *
            <input
              name="groupName"
              required
              maxLength={150}
              placeholder="Ej. Viaje académico Berlín 2027"
              defaultValue={init?.groupName}
            />
          </label>
          <label>
            Colegio / institución
            <input
              name="clientName"
              maxLength={150}
              placeholder="Ej. Colegio Alemán"
              defaultValue={init?.clientName ?? ''}
            />
          </label>
          {existing ? (
            <label>
              Oficina solicitante
              <input value={existing.office.name} disabled />
            </label>
          ) : (
            <label>
              Oficina solicitante *
              <select name="officeId" required defaultValue="">
                <option value="" disabled>
                  Selecciona…
                </option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Persona que solicita (contacto escuela)
            <input
              name="contactName"
              maxLength={150}
              placeholder="Ej. Mtra. Claudia Morales"
              defaultValue={init?.contactName ?? ''}
            />
          </label>
          <label>
            Correo del solicitante
            <input
              name="contactEmail"
              type="email"
              maxLength={200}
              placeholder="nombre@colegio.edu.mx"
              defaultValue={init?.contactEmail ?? ''}
            />
          </label>
          <label>
            Tipo de programa
            <input
              name="program"
              list="program-types"
              maxLength={150}
              placeholder="Elige o escribe…"
              defaultValue={init?.program ?? ''}
            />
            <datalist id="program-types">
              {PROGRAM_TYPES.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label>
            Ciudad destino *
            <input name="city" required maxLength={150} placeholder="Ej. Toronto" defaultValue={init?.city} />
          </label>
          <label>
            País destino *
            <select name="countryCode" required defaultValue={init?.countryCode ?? ''} key={countries.length}>
              <option value="" disabled>
                Selecciona…
              </option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha límite entrega propuesta
            <input name="dueDate" type="date" defaultValue={init?.dueDate ?? ''} />
          </label>
          <label>
            Fecha de salida *
            <input name="departureDate" type="date" required defaultValue={init?.departureDate} />
          </label>
          <label>
            Fecha de regreso *
            <input name="returnDate" type="date" required defaultValue={init?.returnDate} />
          </label>
          <div className={s.counts}>
            <label>
              Alumnos *
              <input
                name="participants"
                type="number"
                min={1}
                max={1000}
                required
                defaultValue={init?.participants}
              />
            </label>
            <label>
              Chaperones
              <input
                name="chaperones"
                type="number"
                min={0}
                max={1000}
                defaultValue={init?.chaperones ?? 0}
              />
            </label>
            <label>
              Staff EE
              <input name="staff" type="number" min={0} max={1000} defaultValue={init?.staff ?? 0} />
            </label>
          </div>
          <div className={s.money}>
            <label>
              {basis === 'TOTAL' ? 'Presupuesto total del grupo' : 'Presupuesto estimado por alumno'}
              <input
                name="budgetAmount"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                placeholder="Ej. 85000"
                defaultValue={init?.budget?.amount}
              />
            </label>
            <label>
              Moneda
              <select name="budgetCurrency" defaultValue={init?.budget?.currency ?? 'MXN'}>
                {CurrencyCode.options.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Prioridad
            <select name="priority" defaultValue={init?.priority ?? 'NORMAL'}>
              {Object.entries(PRIORITY_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Archivo de referencia (hasta 3 MB)
            <input
              type="file"
              accept=".pdf,.doc,.docx,.xlsx,.xls,.csv,.png,.jpg,.jpeg"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > MAX_BYTES) {
                  setError('El archivo pesa más de 3 MB');
                  e.target.value = '';
                  return;
                }
                setFile(f);
              }}
            />
          </label>
          <div className={s.wide}>
            <label>
              Requerimientos especiales (dietas, visas, médicos)
              <textarea
                name="requirements"
                rows={3}
                maxLength={4000}
                defaultValue={init?.requirements ?? ''}
              />
            </label>
            <label>
              Comentarios comerciales (internos)
              <textarea
                name="commercialNotes"
                rows={3}
                maxLength={4000}
                defaultValue={init?.commercialNotes ?? ''}
              />
            </label>
          </div>
        </div>

        <div ref={(el) => void (panes.current[1] = el)} hidden={step !== 1}>
          <div className={s.grid2}>
            {SPEC_FIELDS.map(({ key, label, placeholder }) => (
              <label key={key}>
                {label}
                <input
                  name={`spec_${key}`}
                  maxLength={2000}
                  placeholder={placeholder}
                  defaultValue={init?.specifications?.[key] ?? ''}
                />
              </label>
            ))}
          </div>
          <div className={`${s.grid2} ${s.section}`}>
            <ListEditor
              title="Servicios incluidos"
              placeholder="Ej. Seguro médico internacional"
              items={included}
              onChange={setIncluded}
            />
            <ListEditor
              title="Servicios no incluidos"
              placeholder="Ej. Trámite de pasaporte y visa"
              items={excluded}
              onChange={setExcluded}
            />
          </div>
          <div className={s.section}>
            <h3 className={s.subhead}>Campos adicionales</h3>
            <div className={s.addRow}>
              <input
                aria-label="Nombre del campo"
                placeholder="Nombre (ej. Rango de edad)"
                maxLength={100}
                value={extra.name}
                onChange={(e) => setExtra({ ...extra, name: e.target.value })}
              />
              <input
                aria-label="Valor del campo"
                placeholder="Valor (ej. 14 a 18 años)"
                maxLength={300}
                value={extra.value}
                onChange={(e) => setExtra({ ...extra, value: e.target.value })}
              />
              <button
                type="button"
                className={s.dark}
                onClick={() => {
                  // ":" separates name from value in storage, so it can't be part of the name.
                  const name = extra.name.replaceAll(':', ' ').trim();
                  if (!name) return;
                  setExtras([...extras.filter((x) => x.name !== name), { name, value: extra.value.trim() }]);
                  setExtra({ name: '', value: '' });
                }}
              >
                + Añadir campo
              </button>
            </div>
            <ul className={s.items}>
              {extras.map((x) => (
                <li key={x.name}>
                  <span>
                    <b>{x.name}:</b> {x.value}
                  </span>
                  <button
                    type="button"
                    className={s.remove}
                    aria-label={`Quitar ${x.name}`}
                    onClick={() => setExtras(extras.filter((y) => y !== x))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div hidden={step !== 2}>
          <section className={s.summary} aria-label="Resumen">
            <div className={s.sumHead}>
              <div>
                <small>Folio</small>
                <strong className={s.mono}>{folio ?? 'Se asigna al registrar'}</strong>
              </div>
              <div className={s.right}>
                <small>Programa</small>
                <strong>{v('program')}</strong>
              </div>
            </div>
            <dl className={s.facts}>
              <div>
                <dt>Grupo / escuela</dt>
                <dd>
                  {v('groupName')}
                  {summary.clientName?.trim() ? ` · ${summary.clientName.trim()}` : ''}
                </dd>
              </div>
              <div>
                <dt>Solicitante</dt>
                <dd>{v('contactName')}</dd>
              </div>
              <div>
                <dt>Destino</dt>
                <dd>{summary.city ? `${summary.city}, ${countryName}` : '—'}</dd>
              </div>
              <div>
                <dt>Fechas del viaje</dt>
                <dd className={s.mono}>
                  {fmtDate(summary.departureDate || null)} → {fmtDate(summary.returnDate || null)}
                </dd>
              </div>
              <div>
                <dt>Fecha límite propuesta</dt>
                <dd className={s.mono}>{fmtDate(summary.dueDate || null)}</dd>
              </div>
              <div>
                <dt>Aforo inicial</dt>
                <dd className={s.mono}>
                  {summary.participants || 0} alumnos · {summary.chaperones || 0} chap. · {summary.staff || 0}{' '}
                  staff
                </dd>
              </div>
              <div>
                <dt>Presupuesto objetivo</dt>
                <dd className={s.mono}>
                  {summary.budgetAmount?.trim()
                    ? `${summary.budgetAmount.trim()} ${summary.budgetCurrency} ${basis === 'TOTAL' ? 'total' : 'por alumno'}`
                    : 'No indicado'}
                </dd>
              </div>
              <div>
                <dt>Alojamiento</dt>
                <dd>{v('spec_accommodation')}</dd>
              </div>
              <div>
                <dt>Servicios</dt>
                <dd>
                  {included.length} incluidos · {excluded.length} no incluidos
                </dd>
              </div>
              <div>
                <dt>Oficina</dt>
                <dd>{officeName ?? '—'}</dd>
              </div>
            </dl>
          </section>
          <p className="muted">
            {isDraft
              ? 'Al registrar, la solicitud pasa a “Por asignar” para que coordinación asigne cotizador.'
              : 'Los cambios quedan en la bitácora de la solicitud.'}
          </p>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className={s.foot}>
        <button type="button" className="secondary" onClick={() => router.back()}>
          Cancelar
        </button>
        <button type="button" className="secondary" disabled={saving} onClick={() => void saveDraft()}>
          {saving ? 'Guardando…' : isDraft ? 'Guardar borrador' : 'Guardar'}
        </button>
        {notice && (
          <span className={s.notice} role="status">
            {notice}
          </span>
        )}
        <span className={s.spacer} />
        {step > 0 && (
          <button type="button" className="secondary" onClick={() => goTo(step - 1)}>
            Anterior
          </button>
        )}
        {step < 2 ? (
          <button type="button" className={s.dark} onClick={() => goTo(step + 1)}>
            Siguiente paso
          </button>
        ) : (
          <button type="button" disabled={saving} onClick={() => void register()}>
            {isDraft ? `✓ Registrar solicitud${folio ? ` (${folio})` : ''}` : 'Guardar cambios'}
          </button>
        )}
      </footer>
    </form>
  );
}
