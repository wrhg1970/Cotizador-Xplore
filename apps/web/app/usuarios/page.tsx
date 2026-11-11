'use client';

import { RoleName } from '@ee/contracts';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { ConfigTabs } from '../ConfigTabs';
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

const STATUS = { ACTIVE: 'Activo', INVITED: 'Invitado', DISABLED: 'Desactivado' } as const;
const STATUS_BADGE = { ACTIVE: 'st-won', INVITED: 'st-sent', DISABLED: '' } as const;

/** US-002, US-003: office admins invite people and grant privileges, including "Autorizar viaje". */
export default function UsersPage() {
  const me = useMe();
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeId, setOfficeId] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<UserRow['status']>('ACTIVE');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [inviting, setInviting] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

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
    if (ok) {
      form.reset();
      setInviting(false);
      setStatus('INVITED');
    }
  }

  if (me && !adminOffices.length && offices.length)
    return (
      <ConfigTabs current="usuarios">
        <p className="muted">Solo los coordinadores de oficina administran usuarios.</p>
      </ConfigTabs>
    );

  const q = query.trim().toLowerCase();
  const shown = users.filter(
    (u) =>
      u.status === status &&
      (!q || `${u.name} ${u.email}`.toLowerCase().includes(q)) &&
      (!role || u.officeRoles.some((r) => r.role === role)),
  );
  const editUser = users.find((u) => u.id === editId);
  const saveOffices = (u: UserRow, officeIds: string[]) =>
    void run(`/users/${u.id}/offices`, { method: 'PUT', body: { officeIds } });

  return (
    <ConfigTabs current="usuarios">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="cfg-sub" role="group" aria-label="Estado">
        {(Object.keys(STATUS) as UserRow['status'][]).map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {STATUS[s]}s <small>{users.filter((u) => u.status === s).length}</small>
          </button>
        ))}
      </div>
      <div className="cfg-split">
        <section className="card" aria-label="Usuarios de la oficina">
          <div className="cfg-bar">
            {adminOffices.length > 1 && (
              <select aria-label="Oficina" value={current} onChange={(e) => setOfficeId(e.target.value)}>
                {adminOffices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <input
              type="search"
              aria-label="Buscar usuario"
              placeholder="Nombre o correo"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Filtrar por privilegio"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="">Privilegio: todos</option>
              {RoleName.options.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <span className="sp" />
            <button type="button" aria-expanded={inviting} onClick={() => setInviting(!inviting)}>
              + Invitar usuario
            </button>
          </div>
          {inviting && (
            <form className="row cfg-add" onSubmit={invite} aria-label="Dar de alta">
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
              <button type="button" className="secondary" onClick={() => setInviting(false)}>
                Cancelar
              </button>
            </form>
          )}
          {shown.length === 0 ? (
            <p className="muted">Nadie con estos filtros.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Estado</th>
                    <th>Privilegios</th>
                    {isSysAdmin && <th className="num">Oficinas</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => (
                    <tr key={u.id} className={u.id === editId ? 'sel' : undefined}>
                      <td>
                        <strong>{u.name}</strong>
                        <div className="muted small">{u.email}</div>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[u.status]}`}>{STATUS[u.status]}</span>
                      </td>
                      <td>
                        {u.officeRoles.map((r) => (
                          <span key={r.id} className="badge role">
                            {ROLE_LABEL[r.role]}
                          </span>
                        ))}
                      </td>
                      {isSysAdmin && <td className="num">{u.officeIds?.length ?? ''}</td>}
                      <td className="cfg-acts">
                        <button
                          className="link"
                          aria-label={`Editar ${u.name}`}
                          onClick={() => setEditId(u.id === editId ? null : u.id)}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {editUser && (
          <aside className="card cfg-panel" aria-label={`Editar ${editUser.name}`}>
            <h2>{editUser.name}</h2>
            <p className="muted small">
              {editUser.email} · {STATUS[editUser.status]}
            </p>
            <fieldset className="plain" aria-label={`Privilegios de ${editUser.name}`}>
              <legend className="eyebrow">Privilegios</legend>
              {grantable.map((r) => {
                const grant = editUser.officeRoles.find((x) => x.role === r);
                return (
                  <label key={r} className="inline">
                    <input
                      type="checkbox"
                      checked={!!grant}
                      onChange={() =>
                        void (grant
                          ? run(`/users/${editUser.id}/roles/${grant.id}`, { method: 'DELETE' })
                          : run(`/users/${editUser.id}/roles`, {
                              method: 'POST',
                              body: { officeId: current, role: r },
                            }))
                      }
                    />{' '}
                    {ROLE_LABEL[r]}
                  </label>
                );
              })}
            </fieldset>
            {isSysAdmin && editUser.officeIds && (
              <fieldset className="plain" aria-label={`Oficinas de ${editUser.name}`}>
                <legend className="eyebrow">Oficinas con acceso</legend>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={offices.every((o) => editUser.officeIds?.includes(o.id))}
                    // Unchecking "todas" keeps only the office being viewed; at least one must stay.
                    onChange={(e) =>
                      saveOffices(editUser, e.target.checked ? offices.map((o) => o.id) : [current])
                    }
                  />{' '}
                  <strong>Todas las oficinas</strong>
                </label>
                <div className="cfg-scroll">
                  {offices.map((o) => {
                    const ids = editUser.officeIds ?? [];
                    const on = ids.includes(o.id);
                    return (
                      <label key={o.id} className="inline">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={on && ids.length === 1}
                          onChange={() =>
                            saveOffices(editUser, on ? ids.filter((x) => x !== o.id) : [...ids, o.id])
                          }
                        />{' '}
                        {o.name}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <p className="muted small">Los cambios se guardan al marcar.</p>
            <button type="button" className="secondary" onClick={() => setEditId(null)}>
              Cerrar
            </button>
          </aside>
        )}
      </div>
    </ConfigTabs>
  );
}
