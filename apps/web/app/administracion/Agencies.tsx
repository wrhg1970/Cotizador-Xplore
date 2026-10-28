'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { CreateAgency } from '@ee/contracts';
import { api, errorText } from '../lib/api';

interface Agency {
  id: string;
  code: string;
  name: string;
  active: boolean;
  allowedDomains: string[];
  customDomain: string | null;
  offices: number;
  users: number;
}

const domains = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

/** Xplore Together only: register agencies and the Google domains their people sign in with. */
export function Agencies() {
  const [rows, setRows] = useState<Agency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    api<Agency[]>('/agencies').then(setRows, (e) => setError(errorText(e)));
  }, []);
  useEffect(reload, [reload]);

  async function run(done: string, call: () => Promise<unknown>) {
    setError(null);
    setNotice(null);
    try {
      await call();
      setNotice(done);
      reload();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    const body: CreateAgency = {
      code: text('code').toUpperCase(),
      name: text('name'),
      allowedDomains: domains(f.get('allowedDomains')),
      officeCode: text('officeCode').toUpperCase(),
      officeName: text('officeName'),
      adminEmail: text('adminEmail'),
      adminName: text('adminName'),
    };
    if (await run(`Agencia ${body.name} creada`, () => api('/agencies', { method: 'POST', body })))
      form.reset();
  }

  return (
    <section aria-labelledby="agencias">
      <h2 id="agencias">Agencias</h2>
      <p className="muted">
        Cada agencia tiene sus oficinas, usuarios, catálogos y marca, sin ver los de las demás. Su gente entra
        con Google desde los dominios de Workspace que pongas aquí; su administrador invita al resto.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <table>
        <thead>
          <tr>
            <th>Agencia</th>
            <th>Dominios de Google</th>
            <th>Oficinas</th>
            <th>Usuarios</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                <strong>{a.name}</strong> <span className="muted">{a.code}</span>
                {a.customDomain && <div className="muted">{a.customDomain}</div>}
              </td>
              <td>
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const allowedDomains = domains(new FormData(e.currentTarget).get('allowedDomains'));
                    void run(`Dominios de ${a.name} guardados`, () =>
                      api(`/agencies/${a.id}`, { method: 'PATCH', body: { allowedDomains } }),
                    );
                  }}
                >
                  <input
                    name="allowedDomains"
                    aria-label={`Dominios de ${a.name}`}
                    defaultValue={a.allowedDomains.join(', ')}
                    placeholder={a.code === 'EE' ? 'Los del despliegue' : 'agencia.com'}
                  />
                  <button>Guardar dominios</button>
                </form>
              </td>
              <td>{a.offices}</td>
              <td>{a.users}</td>
              <td>
                {a.active ? 'Activa' : 'Desactivada'}{' '}
                {a.code !== 'EE' && (
                  <button
                    type="button"
                    onClick={() =>
                      run(`${a.name} ${a.active ? 'desactivada' : 'activada'}`, () =>
                        api(`/agencies/${a.id}`, { method: 'PATCH', body: { active: !a.active } }),
                      )
                    }
                  >
                    {a.active ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create}>
        <h3>Nueva agencia</h3>
        <div className="row">
          <label>
            Nombre
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Código
            <input name="code" required pattern="[A-Za-z0-9-]{2,20}" placeholder="VIAJESX" />
          </label>
          <label>
            Dominios de Google Workspace
            <input name="allowedDomains" required placeholder="agencia.com" />
          </label>
        </div>
        <div className="row">
          <label>
            Primera oficina
            <input name="officeName" required maxLength={120} placeholder="Matriz" />
          </label>
          <label>
            Código de oficina
            <input name="officeCode" required pattern="[A-Za-z0-9-]{2,20}" placeholder="MTZ" />
          </label>
        </div>
        <div className="row">
          <label>
            Administrador (correo)
            <input name="adminEmail" type="email" required />
          </label>
          <label>
            Nombre del administrador
            <input name="adminName" required maxLength={120} />
          </label>
        </div>
        <button>Crear agencia</button>
      </form>
    </section>
  );
}
