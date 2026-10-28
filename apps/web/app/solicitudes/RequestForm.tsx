'use client';

import { CurrencyCode, type RequestDraft } from '@ee/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { PRIORITY_LABEL, SPEC_LABEL, type TravelRequestDto } from '../lib/types';

interface Office {
  id: string;
  code: string;
  name: string;
}
interface Country {
  code: string;
  name: string;
}

const optional = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? undefined : s;
};

const SPEC_KEYS = Object.keys(SPEC_LABEL) as (keyof typeof SPEC_LABEL)[];

/** Only the filled blocks; null when every block is empty, so the request carries no empty object. */
const specsFrom = (f: FormData) => {
  const filled = SPEC_KEYS.flatMap((k) => {
    const v = optional(f.get(`spec_${k}`));
    return v ? [[k, v] as const] : [];
  });
  return filled.length ? Object.fromEntries(filled) : null;
};

/** Create (no `existing`, optionally prefilled from a `draft`) or edit form; the server re-validates everything. */
export function RequestForm({ existing, draft }: { existing?: TravelRequestDto; draft?: RequestDraft }) {
  const router = useRouter();
  const init = existing ?? draft;
  const [offices, setOffices] = useState<Office[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [hasBudget, setHasBudget] = useState(!!existing?.budget);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Office[]>('/offices').then(setOffices, () => undefined);
    api<Country[]>('/catalogs/countries').then(setCountries, () => undefined);
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      groupName: String(f.get('groupName')).trim(),
      clientName: optional(f.get('clientName')),
      program: optional(f.get('program')),
      city: String(f.get('city')).trim(),
      countryCode: String(f.get('countryCode')),
      departureDate: String(f.get('departureDate')),
      returnDate: String(f.get('returnDate')),
      participants: Number(f.get('participants')),
      chaperones: Number(f.get('chaperones') || 0),
      staff: Number(f.get('staff') || 0),
      budget: hasBudget
        ? {
            amount: String(f.get('budgetAmount')).trim(),
            currency: String(f.get('budgetCurrency')),
            basis: String(f.get('budgetBasis')),
          }
        : null,
      requirements: optional(f.get('requirements')),
      specifications: specsFrom(f),
      priority: String(f.get('priority')),
      dueDate: optional(f.get('dueDate')),
    };
    setSaving(true);
    setError(null);
    try {
      const saved = existing
        ? await api<TravelRequestDto>(`/requests/${existing.id}`, {
            method: 'PATCH',
            body: { ...payload, version: existing.version },
          })
        : await api<TravelRequestDto>('/requests', {
            method: 'POST',
            body: { ...payload, officeId: String(f.get('officeId')) },
          });
      router.push(`/solicitudes/${saved.id}`);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate={false}>
      <div className="grid">
        {!existing && (
          <label>
            Oficina
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
          Nombre del grupo
          <input name="groupName" required maxLength={150} defaultValue={init?.groupName} />
        </label>
        <label>
          Escuela / cliente <span className="hint">opcional</span>
          <input name="clientName" maxLength={150} defaultValue={init?.clientName ?? ''} />
        </label>
        <label>
          Programa <span className="hint">opcional</span>
          <input name="program" maxLength={150} defaultValue={init?.program ?? ''} />
        </label>
        <label>
          Ciudad(es)
          <input name="city" required maxLength={150} defaultValue={init?.city} />
        </label>
        <label>
          País
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
          Salida
          <input name="departureDate" type="date" required defaultValue={init?.departureDate} />
        </label>
        <label>
          Regreso
          <input name="returnDate" type="date" required defaultValue={init?.returnDate} />
        </label>
        <label>
          Participantes
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
          <input name="chaperones" type="number" min={0} max={1000} defaultValue={init?.chaperones ?? 0} />
        </label>
        <label>
          Staff
          <input name="staff" type="number" min={0} max={1000} defaultValue={init?.staff ?? 0} />
        </label>
        <label>
          Prioridad
          <select name="priority" defaultValue={existing?.priority ?? 'NORMAL'}>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha límite <span className="hint">opcional</span>
          <input name="dueDate" type="date" defaultValue={existing?.dueDate ?? ''} />
        </label>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: '16px 0 0' }}>
        <legend>
          <label style={{ flexDirection: 'row', alignItems: 'center' }}>
            <input type="checkbox" checked={hasBudget} onChange={(e) => setHasBudget(e.target.checked)} />
            El cliente indicó un presupuesto
          </label>
        </legend>
        {hasBudget && (
          <div className="grid">
            <label>
              Importe
              <input
                name="budgetAmount"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                required
                defaultValue={existing?.budget?.amount}
              />
            </label>
            <label>
              Moneda
              <select name="budgetCurrency" defaultValue={existing?.budget?.currency ?? 'MXN'}>
                {CurrencyCode.options.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Base del presupuesto
              <select name="budgetBasis" defaultValue={existing?.budget?.basis ?? 'PER_PARTICIPANT'}>
                <option value="PER_PARTICIPANT">Por participante</option>
                <option value="TOTAL">Total del grupo</option>
              </select>
            </label>
          </div>
        )}
      </fieldset>

      <label style={{ marginTop: 16 }}>
        Requerimientos <span className="hint">opcional</span>
        <textarea name="requirements" maxLength={4000} defaultValue={init?.requirements ?? ''} />
      </label>

      <details style={{ marginTop: 16 }} open={!!existing?.specifications}>
        <summary>
          Especificaciones del viaje <span className="hint">opcional</span>
        </summary>
        <div className="grid" style={{ marginTop: 8 }}>
          {SPEC_KEYS.map((k) => (
            <label key={k}>
              {SPEC_LABEL[k]}
              <textarea
                name={`spec_${k}`}
                maxLength={2000}
                defaultValue={existing?.specifications?.[k] ?? ''}
              />
            </label>
          ))}
        </div>
      </details>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" disabled={saving}>
          {saving ? 'Guardando…' : existing ? 'Guardar cambios' : 'Guardar borrador'}
        </button>
        <button type="button" className="secondary" onClick={() => router.back()}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
