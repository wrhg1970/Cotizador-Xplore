'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { CurrencyCode } from '@ee/contracts';
import { fmtDate, type OfficialRateDto, ROLE_LABEL, type RolePolicy } from '../lib/types';
import { useMe } from '../lib/useMe';

type Row = RolePolicy & { role: Exclude<keyof typeof ROLE_LABEL, 'SYSTEM_ADMIN'> };
interface Office {
  id: string;
  code: string;
  name: string;
}

const FLAG = {
  canView: 'Ver',
  canCreate: 'Crear',
  canEdit: 'Editar',
  canDelete: 'Borrar (cancelar)',
  allOffices: 'Todas las oficinas',
  viewInternalCosts: 'Ve costos internos',
  exportInternalXlsx: 'Descarga Excel interno',
} as const;

/** System admin settings: what each role may do, and the offices that exist. */
export default function AdminPage() {
  const me = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [rates, setRates] = useState<OfficialRateDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isSysAdmin = !!me?.roles.some((r) => r.role === 'SYSTEM_ADMIN');

  const reload = useCallback(() => {
    api<Row[]>('/role-policies').then(setRows, (e) => setError(errorText(e)));
    api<Office[]>('/offices').then(setOffices, (e) => setError(errorText(e)));
    api<OfficialRateDto[]>('/official-rates').then(setRates, (e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    if (isSysAdmin) reload();
  }, [isSysAdmin, reload]);

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
      reload();
      return false;
    }
  }

  const save = (row: Row, change: Partial<RolePolicy>) => {
    const { role, ...policy } = { ...row, ...change };
    // Excel interno always needs costs; keep the pair consistent instead of failing validation.
    if (change.viewInternalCosts === false) policy.exportInternalXlsx = false;
    if (change.exportInternalXlsx) policy.viewInternalCosts = true;
    return run(`Permisos de ${ROLE_LABEL[role]} guardados`, () =>
      api(`/role-policies/${role}`, { method: 'PUT', body: policy }),
    );
  };

  async function createOffice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = { code: String(f.get('code')).trim().toUpperCase(), name: String(f.get('name')).trim() };
    if (await run(`Oficina ${body.code} creada`, () => api('/offices', { method: 'POST', body })))
      form.reset();
  }

  async function publishRate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = {
      fromCurrency: f.get('fromCurrency'),
      toCurrency: f.get('toCurrency'),
      rate: String(f.get('rate')).trim(),
      rateDate: f.get('rateDate'),
      source: String(f.get('source')).trim(),
    };
    const done = `Tipo de cambio ${body.fromCurrency}→${body.toCurrency} publicado`;
    if (await run(done, () => api('/official-rates', { method: 'POST', body }))) form.reset();
  }

  if (me && !isSysAdmin) return <p className="error">Solo un administrador del sistema puede entrar aquí.</p>;

  return (
    <>
      <h1>Administración</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}

      <section aria-labelledby="permisos">
        <h2 id="permisos">Permisos por rol</h2>
        <p className="muted">
          Ver: consulta las solicitudes de sus oficinas. Crear: abre solicitudes nuevas. Editar: modifica las
          solicitudes y cotizaciones en las que participa. Borrar: cancela solicitudes y retira plantillas;
          nada se elimina de verdad, todo queda en la bitácora. Los pasos del flujo (quién cotiza, autoriza y
          envía) siguen fijos: nadie autoriza una cotización que preparó. El administrador del sistema siempre
          puede todo. Las oficinas de cada persona se eligen en Usuarios.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rol</th>
                {Object.values(FLAG).map((l) => (
                  <th key={l}>{l}</th>
                ))}
                <th>Tope de autorización (MXN, total del grupo)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.role}>
                  <th scope="row">{ROLE_LABEL[row.role]}</th>
                  {(Object.keys(FLAG) as (keyof typeof FLAG)[]).map((k) => (
                    <td key={k}>
                      <input
                        type="checkbox"
                        aria-label={`${FLAG[k]}: ${ROLE_LABEL[row.role]}`}
                        checked={row[k]}
                        onChange={(e) => void save(row, { [k]: e.target.checked })}
                      />
                    </td>
                  ))}
                  <td>
                    {row.role === 'APPROVER' ? (
                      <input
                        aria-label="Tope de autorización en pesos"
                        inputMode="decimal"
                        placeholder="Sin tope"
                        defaultValue={row.approvalLimitMxn ?? ''}
                        key={row.approvalLimitMxn ?? ''}
                        onBlur={(e) => {
                          const v = e.target.value.replace(/[,\s$]/g, '');
                          const limit = v === '' ? null : v;
                          if (
                            limit !== row.approvalLimitMxn &&
                            Number(limit) !== Number(row.approvalLimitMxn)
                          )
                            void save(row, { approvalLimitMxn: limit });
                        }}
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="tipos">
        <h2 id="tipos">Tipos de cambio oficiales</h2>
        <p className="muted">
          Los cotizadores los usan para prellenar cada cotización, que guarda su propia copia con fecha y
          fuente. Publicar uno nuevo no cambia cotizaciones existentes; el historial no se borra.
        </p>
        {rates.length > 0 && (
          <div className="table-wrap">
            <table aria-label="Tipos de cambio vigentes">
              <thead>
                <tr>
                  <th>Par</th>
                  <th className="num">Tipo</th>
                  <th>Fecha</th>
                  <th>Fuente</th>
                  <th>Publicó</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td>
                      1 {r.fromCurrency} = {r.toCurrency}
                    </td>
                    <td className="num">{r.rate}</td>
                    <td>{fmtDate(r.rateDate)}</td>
                    <td>{r.source}</td>
                    <td>{r.capturedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={publishRate} className="row" style={{ marginTop: 12 }}>
          <label>
            De
            <select name="fromCurrency" defaultValue="USD">
              {CurrencyCode.options.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            A
            <select name="toCurrency" defaultValue="MXN">
              {CurrencyCode.options.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Tipo de cambio
            <input name="rate" required inputMode="decimal" pattern="\d+(\.\d{1,6})?" />
          </label>
          <label>
            Fecha
            <input name="rateDate" type="date" required />
          </label>
          <label>
            Fuente
            <input name="source" required maxLength={150} placeholder="Banxico FIX" />
          </label>
          <button>Publicar</button>
        </form>
      </section>

      <section aria-labelledby="oficinas">
        <h2 id="oficinas">Oficinas</h2>
        <ul>
          {offices.map((o) => (
            <li key={o.id}>
              <strong>{o.code}</strong> · {o.name}
            </li>
          ))}
        </ul>
        <form onSubmit={createOffice} className="row">
          <label>
            Código
            <input name="code" required pattern="[A-Za-z0-9\-]{2,20}" maxLength={20} placeholder="MTY" />
          </label>
          <label>
            Nombre
            <input name="name" required maxLength={120} />
          </label>
          <button>Agregar oficina</button>
        </form>
      </section>
    </>
  );
}
