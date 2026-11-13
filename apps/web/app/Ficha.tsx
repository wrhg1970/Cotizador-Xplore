'use client';

import { type FormEvent, type ReactNode, useState } from 'react';
import { fmtDateTime } from './lib/types';

export interface Contact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

/** Wissify column/badge: "Sin vincular" until the future sync writes the id. */
export function WissifyBadge({ id }: { id: string | null }) {
  return <span className={id ? 'pill ok' : 'pill'}>{id ? 'Vinculado' : 'Sin vincular'}</span>;
}

/** Headline figures under the name of a client or supplier. */
export function FichaStrip({ items }: { items: [ReactNode, string][] }) {
  return (
    <dl className="ficha-strip">
      {items.map(([value, label]) => (
        <div key={label}>
          <dd>{value}</dd>
          <dt>{label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Pill tab row; the count shows next to the label. */
export function FichaTabs<T extends string>({
  tabs,
  tab,
  onTab,
  label,
}: {
  tabs: (readonly [T, string, number?])[];
  tab: T;
  onTab: (t: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map(([key, text, count]) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => onTab(key)}>
          {text}
          {count !== undefined && <span className="tab-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

/** "Contactos" tab: compact table plus an add row. */
export function ContactsTab({
  contacts,
  canAdd,
  onAdd,
  onRemove,
}: {
  contacts: Contact[];
  canAdd: boolean;
  onAdd: (c: Omit<Contact, 'id'>) => Promise<boolean>;
  onRemove?: (id: string) => void;
}) {
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const opt = (k: string) => String(f.get(k) ?? '').trim() || null;
    const ok = await onAdd({
      name: String(f.get('name')).trim(),
      role: opt('role'),
      email: opt('email'),
      phone: opt('phone'),
    });
    if (ok) form.reset();
  }
  return (
    <>
      {contacts.length === 0 && <p className="muted">Sin contactos todavía.</p>}
      {contacts.length > 0 && (
        <div className="table-wrap">
          <table className="tray" aria-label="Contactos">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Correo</th>
                <th>Teléfono</th>
                {onRemove && <th />}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    {c.name} {i === 0 && <span className="pill warn">Principal</span>}
                  </td>
                  <td>{c.role ?? '—'}</td>
                  <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td>
                  <td>{c.phone ?? '—'}</td>
                  {onRemove && (
                    <td className="num">
                      <button type="button" className="secondary" onClick={() => onRemove(c.id)}>
                        Quitar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canAdd && (
        <form onSubmit={(e) => void add(e)} className="row" aria-label="Nuevo contacto">
          <label>
            Nombre
            <input name="name" required maxLength={150} />
          </label>
          <label>
            Cargo
            <input name="role" maxLength={150} />
          </label>
          <label>
            Correo
            <input name="email" type="email" maxLength={200} />
          </label>
          <label>
            Teléfono
            <input name="phone" type="tel" maxLength={25} />
          </label>
          <button>Agregar contacto</button>
        </form>
      )}
    </>
  );
}

/** "Wissify" tab: read-only until the CRM/ERP integration exists. */
export function WissifyTab({
  id,
  syncedAt,
  fields,
}: {
  id: string | null;
  syncedAt: string | null;
  fields: [string, string][];
}) {
  return (
    <>
      <div className="grid">
        <label>
          ID en Wissify
          <input value={id ?? ''} placeholder="Sin vincular" disabled />
        </label>
        <label>
          Estado
          <input value={id ? 'Vinculado' : 'Sin vincular'} disabled />
        </label>
        <label>
          Última sincronización
          <input value={syncedAt ? fmtDateTime(syncedAt) : '—'} disabled />
        </label>
      </div>
      <h3 className="ficha-sect">Qué se enviará o recibirá</h3>
      <div className="table-wrap">
        <table className="tray">
          <thead>
            <tr>
              <th>Dato del cotizador</th>
              <th>Dirección</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(([what, dir]) => (
              <tr key={what}>
                <td>{what}</td>
                <td>{dir}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        La vinculación se activa cuando tengamos la API y las credenciales de Wissify; los campos de Wissify
        no se editan a mano.
      </p>
    </>
  );
}

/** "Borrar" for an empty client or supplier: disabled with the reason when it has history, else asks to type the name. */
export function DeleteButton({
  name,
  blocked,
  detail,
  onDelete,
}: {
  name: string;
  blocked: string | null;
  detail: string;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="ficha-delete">
      <button
        type="button"
        className="danger"
        disabled={!!blocked || open}
        onClick={() => setOpen(true)}
        aria-describedby={blocked ? 'borrar-motivo' : undefined}
      >
        Borrar
      </button>
      {blocked && (
        <p id="borrar-motivo" className="muted">
          {blocked}
        </p>
      )}
      {open && (
        <div className="confirm-delete" role="alertdialog" aria-label={`Borrar ${name}`}>
          <p>
            <strong>¿Borrar definitivamente “{name}”?</strong> {detail} No se puede deshacer y queda en la
            bitácora.
          </p>
          <label>
            Escribe el nombre para confirmar
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </label>
          <div className="row">
            <button
              type="button"
              className="danger"
              disabled={typed.trim() !== name.trim() || busy}
              onClick={() => {
                setBusy(true);
                void onDelete().finally(() => setBusy(false));
              }}
            >
              Borrar definitivamente
            </button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
