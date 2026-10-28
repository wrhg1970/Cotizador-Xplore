'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { type AlertSettings, CurrencyCode } from '@ee/contracts';
import { fmtDate, type OfficialRateDto, ROLE_LABEL, type RolePolicy } from '../lib/types';
import { useMe } from '../lib/useMe';

type Row = RolePolicy & { role: Exclude<keyof typeof ROLE_LABEL, 'SYSTEM_ADMIN'> };
interface Office {
  id: string;
  code: string;
  name: string;
  active: boolean;
  requests: number;
  userRoles: number;
  templates: number;
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

const ALERT_FIELDS: [keyof AlertSettings, string][] = [
  ['unquotedDays', 'Solicitud sin cotizar (días)'],
  ['reviewDays', 'Autorización pendiente (días)'],
  ['sentNoAnswerDays', 'Propuesta sin respuesta (días)'],
  ['paymentReminderDays', 'Avisar pagos con (días de anticipación)'],
];

/** System admin settings: what each role may do, and the offices that exist. */
export default function AdminPage() {
  const me = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [rates, setRates] = useState<OfficialRateDto[]>([]);
  const [alerts, setAlerts] = useState<AlertSettings | null>(null);
  const [integrations, setIntegrations] = useState<{ key: string; name: string; configured: boolean }[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isSysAdmin = !!me?.roles.some((r) => r.role === 'SYSTEM_ADMIN');

  const reload = useCallback(() => {
    api<Row[]>('/role-policies').then(setRows, (e) => setError(errorText(e)));
    api<Office[]>('/offices/all').then(setOffices, (e) => setError(errorText(e)));
    api<OfficialRateDto[]>('/official-rates').then(setRates, (e) => setError(errorText(e)));
    api<typeof integrations>('/integrations').then(setIntegrations, (e) => setError(errorText(e)));
    api<AlertSettings>('/settings/alerts').then(setAlerts, (e) => setError(errorText(e)));
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

  async function saveOffice(e: FormEvent<HTMLFormElement>, o: Office) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { code: String(f.get('code')).trim().toUpperCase(), name: String(f.get('name')).trim() };
    if (await run(`Oficina ${body.code} guardada`, () => api(`/offices/${o.id}`, { method: 'PATCH', body })))
      setEditing(null);
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

  async function saveAlerts(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(ALERT_FIELDS.map(([k]) => [k, Number(f.get(k))]));
    await run('Alertas guardadas', () => api('/settings/alerts', { method: 'PUT', body }));
  }

  async function pullBanxico() {
    await run('Tipos de cambio de Banxico al día', () => api('/official-rates/banxico', { method: 'POST' }));
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
          fuente. Publicar uno nuevo no cambia cotizaciones existentes; el historial no se borra. USD y EUR se
          traen solos de Banxico (FIX) cada día hábil cuando el token está configurado.
        </p>
        <button type="button" className="secondary" onClick={() => void pullBanxico()}>
          Traer de Banxico ahora
        </button>
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
        <p className="muted">
          Una oficina con solicitudes, usuarios o plantillas no se borra: se desactiva y conserva su
          historial. Desactivada, ya no aparece para nuevas solicitudes ni para dar privilegios.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Estado</th>
                <th className="num">Solicitudes</th>
                <th className="num">Privilegios</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offices.map((o) =>
                editing === o.id ? (
                  <tr key={o.id}>
                    <td colSpan={6}>
                      <form className="row" onSubmit={(e) => void saveOffice(e, o)}>
                        <label>
                          Código
                          <input
                            name="code"
                            required
                            pattern="[A-Za-z0-9\-]{2,20}"
                            maxLength={20}
                            defaultValue={o.code}
                          />
                        </label>
                        <label>
                          Nombre
                          <input name="name" required maxLength={120} defaultValue={o.name} />
                        </label>
                        <button>Guardar</button>
                        <button type="button" className="secondary" onClick={() => setEditing(null)}>
                          Cancelar
                        </button>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={o.id}>
                    <th scope="row">{o.code}</th>
                    <td>{o.name}</td>
                    <td>{o.active ? 'Activa' : <span className="muted">Desactivada</span>}</td>
                    <td className="num">{o.requests}</td>
                    <td className="num">{o.userRoles}</td>
                    <td className="row">
                      <button
                        className="secondary"
                        aria-label={`Editar ${o.code}`}
                        onClick={() => setEditing(o.id)}
                      >
                        Editar
                      </button>
                      <button
                        className="secondary"
                        aria-label={`${o.active ? 'Desactivar' : 'Activar'} ${o.code}`}
                        onClick={() =>
                          void run(`Oficina ${o.code} ${o.active ? 'desactivada' : 'activada'}`, () =>
                            api(`/offices/${o.id}`, { method: 'PATCH', body: { active: !o.active } }),
                          )
                        }
                      >
                        {o.active ? 'Desactivar' : 'Activar'}
                      </button>
                      {o.requests + o.userRoles + o.templates === 0 && (
                        <button
                          className="danger"
                          aria-label={`Borrar ${o.code}`}
                          onClick={() => {
                            if (window.confirm(`¿Borrar la oficina ${o.code}? No se puede deshacer.`))
                              void run(`Oficina ${o.code} borrada`, () =>
                                api(`/offices/${o.id}`, { method: 'DELETE' }),
                              );
                          }}
                        >
                          Borrar
                        </button>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
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

      {alerts && (
        <section aria-labelledby="alertas">
          <h2 id="alertas">Alertas de vencimiento</h2>
          <p className="muted">
            Días antes de avisar. Llegan en un correo diario (días hábiles, 13:00) y en Mi trabajo. 0 apaga
            esa alerta.
          </p>
          <form onSubmit={saveAlerts} className="row">
            {ALERT_FIELDS.map(([key, label]) => (
              <label key={key}>
                {label}
                <input name={key} type="number" min={0} max={180} required defaultValue={alerts[key]} />
              </label>
            ))}
            <button>Guardar alertas</button>
          </form>
        </section>
      )}

      <section aria-labelledby="integraciones">
        <h2 id="integraciones">Integraciones</h2>
        <p className="muted">
          Se activan al desplegar con su llave (Secret Manager); aquí solo se ve si están configuradas.
        </p>
        <ul>
          {integrations.map((i) => (
            <li key={i.key}>
              <strong>{i.name}</strong> ·{' '}
              {i.configured ? (
                <span className="badge">Configurada</span>
              ) : i.key === 'WISSIFY' ? (
                <span className="muted">Pendiente: Wissify aún no comparte su API</span>
              ) : (
                <span className="muted">No configurada</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
