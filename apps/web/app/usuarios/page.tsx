'use client';

import { RoleName } from '@ee/contracts';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { ROLE_LABEL } from '../lib/types';
import { isOfficeAdmin, useMe } from '../lib/useMe';

interface Office {
  id: string;
  name: string;
}
interface UserRow {
  id: string;
  email: string;
  name: string;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  officeRoles: { id: string; role: RoleName }[];
  /** All offices where the user has privileges; only sent to system admins. */
  officeIds?: string[];
}

const STATUS = { INVITED: 'Invitado', ACTIVE: 'Activo', DISABLED: 'Desactivado' } as const;

/** US-002, US-003: office admins invite people and grant privileges, including "Autorizar viaje". */
export default function UsersPage() {
  const me = useMe();
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeId, setOfficeId] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Office[]>('/offices').then(setOffices, (e) => setError(errorText(e)));
  }, []);
  const adminOffices = offices.filter((o) => isOfficeAdmin(me, o.id));
  const current = officeId || adminOffices[0]?.id || '';
  const isSysAdmin = !!me?.roles.some((r) => r.role === 'SYSTEM_ADMIN');
  const grantable = RoleName.options.filter(
    (r) => isSysAdmin || !['OFFICE_ADMIN', 'SYSTEM_ADMIN'].includes(r),
  );

  const reload = useCallback(() => {
    if (current) api<UserRow[]>(`/users?officeId=${current}`).then(setUsers, (e) => setError(errorText(e)));
  }, [current]);
  useEffect(reload, [reload]);

  async function run(path: string, init: { method: string; body?: unknown }) {
    setError(null);
    try {
      await api(path, init);
      reload();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await run('/users', {
      method: 'POST',
      body: {
        name: String(f.get('name')).trim(),
        email: String(f.get('email')).trim().toLowerCase(),
        officeId: current,
        role: f.get('role'),
      },
    });
    if (ok) form.reset();
  }

  if (me && !adminOffices.length && offices.length)
    return <p className="muted">Solo los coordinadores de oficina administran usuarios.</p>;

  return (
    <>
      <h1>Usuarios</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {adminOffices.length > 1 && (
        <label>
          Oficina
          <select value={current} onChange={(e) => setOfficeId(e.target.value)}>
            {adminOffices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <form className="card row" onSubmit={invite} aria-labelledby="alta">
        <h2 id="alta" style={{ margin: 0, width: '100%' }}>
          Dar de alta
        </h2>
        <label>
          Nombre
          <input name="name" required maxLength={150} />
        </label>
        <label>
          Correo de Google
          <input name="email" type="email" required />
        </label>
        <label>
          Privilegio
          <select name="role" defaultValue="QUOTER" aria-label="Privilegio">
            {grantable.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <button>Invitar</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Estado</th>
              <th>Privilegios</th>
              <th>Agregar privilegio</th>
              {isSysAdmin && <th>Oficinas con acceso</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{STATUS[u.status]}</td>
                <td>
                  {u.officeRoles.map((r) => (
                    <span key={r.id} className="badge" style={{ marginRight: 4 }}>
                      {ROLE_LABEL[r.role]}{' '}
                      {grantable.includes(r.role) && (
                        <button
                          className="secondary"
                          aria-label={`Quitar ${ROLE_LABEL[r.role]} a ${u.name}`}
                          onClick={() => void run(`/users/${u.id}/roles/${r.id}`, { method: 'DELETE' })}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                </td>
                <td>
                  <select
                    aria-label={`Agregar privilegio a ${u.name}`}
                    value=""
                    onChange={(e) =>
                      void run(`/users/${u.id}/roles`, {
                        method: 'POST',
                        body: { officeId: current, role: e.target.value },
                      })
                    }
                  >
                    <option value="" disabled>
                      Selecciona…
                    </option>
                    {grantable
                      .filter((r) => !u.officeRoles.some((x) => x.role === r))
                      .map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                  </select>
                </td>
                {isSysAdmin && u.officeIds && (
                  <td>
                    <details>
                      <summary>
                        {u.officeIds.length} {u.officeIds.length === 1 ? 'oficina' : 'oficinas'}
                      </summary>
                      <p className="muted" style={{ maxWidth: 260 }}>
                        Sus privilegios aplican en todas las oficinas marcadas.
                      </p>
                      <fieldset
                        aria-label={`Oficinas de ${u.name}`}
                        style={{ border: 0, padding: 0, margin: 0 }}
                      >
                        {offices.map((o) => {
                          const ids = u.officeIds ?? [];
                          const on = ids.includes(o.id);
                          return (
                            <label key={o.id} style={{ display: 'block', fontWeight: 'normal' }}>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={on && ids.length === 1}
                                onChange={() =>
                                  void run(`/users/${u.id}/offices`, {
                                    method: 'PUT',
                                    body: { officeIds: on ? ids.filter((x) => x !== o.id) : [...ids, o.id] },
                                  })
                                }
                              />{' '}
                              {o.name}
                            </label>
                          );
                        })}
                      </fieldset>
                    </details>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
