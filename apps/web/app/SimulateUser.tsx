'use client';

import { useState } from 'react';
import { api, errorText } from './lib/api';
import { ROLE_LABEL, type Me } from './lib/types';
import type { RoleName } from '@ee/contracts';

interface Candidate {
  id: string;
  name: string;
  email: string;
  officeRoles: { role: RoleName; office: { code: string } }[];
}

const rolesOf = (c: Candidate) =>
  [...new Set(c.officeRoles.map((r) => ROLE_LABEL[r.role]))].join(', ') || 'Sin roles';

/** Reload so every screen (menu, permissions, data) is fetched again as the new user. */
const reload = () => window.location.assign('/inicio');

/** "Ver como" picker for system admins (V2 "Simular usuario / rol"). Loads the list on first open. */
export function SimulatePicker() {
  const [users, setUsers] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <details
      className="simpick"
      onToggle={(e) => {
        if (e.currentTarget.open && !users)
          api<Candidate[]>('/simulation/users').then(setUsers, (x) => setError(errorText(x)));
      }}
    >
      <summary>Ver como…</summary>
      <div className="card">
        <label>
          Simular usuario
          <select
            defaultValue=""
            disabled={!users}
            onChange={(e) =>
              e.target.value &&
              api('/simulation', { method: 'POST', body: { userId: e.target.value } }).then(reload, (x) =>
                setError(errorText(x)),
              )
            }
          >
            <option value="">{users ? 'Elige a quién…' : 'Cargando…'}</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {rolesOf(u)}
              </option>
            ))}
          </select>
        </label>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Ves menús, permisos y oficinas de esa persona, solo lectura. Queda en la bitácora con tu usuario.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}

/** Shown on every page while simulating, with the way back. */
export function SimulationBar({ me }: { me: Me }) {
  const roles = [...new Set(me.roles.map((r) => ROLE_LABEL[r.role as RoleName] ?? r.role))].join(', ');
  return (
    <div className="simbar" role="status">
      <span>
        Estás viendo la app como <strong>{me.name}</strong> ({roles || 'sin roles'}). Solo lectura: no se
        guardan cambios.
      </span>
      <button type="button" onClick={() => api('/simulation', { method: 'DELETE' }).then(reload, reload)}>
        Volver a mi usuario ({me.simulatedBy?.name})
      </button>
    </div>
  );
}
