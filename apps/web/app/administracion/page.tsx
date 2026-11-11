'use client';

import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import {
  type AgencyBrand,
  type AgencyBrandingInput,
  type AlertSettings,
  type ApprovalRules,
  CurrencyCode,
  MAX_LOGO_BYTES,
} from '@ee/contracts';
import { toBase64 } from '../cotizaciones/[id]/SheetImport';
import { Logo } from '../Logo';
import { Agencies } from './Agencies';
import { ADMIN_TABS, type AdminTab, ConfigTabs } from '../ConfigTabs';
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

/** System admin settings, one tab per subject (?t=…). */
export default function Page() {
  return (
    <Suspense>
      <AdminPage />
    </Suspense>
  );
}

const money = (v: string | undefined) => (v ? Number(v).toLocaleString('en-US') : undefined);

function AdminPage() {
  const me = useMe();
  const t = useSearchParams().get('t');
  const tab: AdminTab = ADMIN_TABS.some(([k]) => k === t) ? (t as AdminTab) : 'permisos';
  const [adding, setAdding] = useState(false);
  const [officeQuery, setOfficeQuery] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [rates, setRates] = useState<OfficialRateDto[]>([]);
  const [alerts, setAlerts] = useState<AlertSettings | null>(null);
  const [brand, setBrand] = useState<AgencyBrand | null>(null);
  const [rules, setRules] = useState<ApprovalRules | null>(null);
  const [goalYear, setGoalYear] = useState(() => new Date().getFullYear());
  const [goals, setGoals] = useState<Record<string, string> | null>(null);
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
    api<AgencyBrand>('/agency/brand').then(setBrand, (e) => setError(errorText(e)));
    api<ApprovalRules>('/settings/approval-rules').then(setRules, (e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    if (isSysAdmin) reload();
  }, [isSysAdmin, reload]);
  useEffect(() => {
    setGoals(null);
    if (isSysAdmin)
      api<Record<string, string>>(`/settings/goals/${goalYear}`).then(setGoals, (e) =>
        setError(errorText(e)),
      );
  }, [isSysAdmin, goalYear]);

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
    if (await run(`Oficina ${body.code} creada`, () => api('/offices', { method: 'POST', body }))) {
      form.reset();
      setAdding(false);
    }
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

  async function saveRules(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const rate = (k: string) => String(Number(f.get(k)) / 100);
    const two = String(f.get('twoLevel') ?? '').trim();
    const body: ApprovalRules = {
      autoApprove: f.get('autoApprove') === 'on',
      autoMinMarginRate: rate('autoMin'),
      autoMaxGroupMxn: String(f.get('autoMax')).replace(/[,\s$]/g, ''),
      twoLevelBelowMarginRate: two ? rate('twoLevel') : null,
    };
    await run('Reglas de autorización guardadas', () =>
      api('/settings/approval-rules', { method: 'PUT', body }),
    );
  }

  async function saveGoals(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // Empty = no goal for that office.
    const body = Object.fromEntries(
      offices
        .map((o) => [o.id, String(f.get(o.id) ?? '').replace(/[,\s$]/g, '')])
        .filter(([, v]) => v !== ''),
    );
    if (
      await run(`Metas ${goalYear} guardadas`, () =>
        api(`/settings/goals/${goalYear}`, { method: 'PUT', body }),
      )
    )
      setGoals(body);
  }

  async function saveBrand(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim() || null;
    // An unchecked "usar color propio" means the Xplore Together default.
    const color = (k: string) => (f.get(`${k}On`) === 'on' ? String(f.get(k)) : null);
    const body: AgencyBrandingInput = {
      brandName: text('brandName'),
      primaryColor: color('primaryColor'),
      accentColor: color('accentColor'),
      proposalFooter: text('proposalFooter'),
      mailFromName: text('mailFromName'),
      customDomain: text('customDomain'),
    };
    await run('Marca guardada; recarga la página para verla en el menú', () =>
      api('/agency/brand', { method: 'PUT', body }),
    );
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) return setError('El logo debe pesar hasta 512 KB');
    await run('Logo guardado', async () =>
      api('/agency/logo', {
        method: 'PUT',
        body: { fileName: file.name, fileBase64: await toBase64(file) },
      }),
    );
  }

  async function pullBanxico() {
    await run('Tipos de cambio de Banxico al día', () => api('/official-rates/banxico', { method: 'POST' }));
  }

  if (me && !isSysAdmin) return <p className="error">Solo un administrador del sistema puede entrar aquí.</p>;

  const q = officeQuery.trim().toLowerCase();
  const shownOffices = offices.filter(
    (o) => (!onlyActive || o.active) && (!q || `${o.code} ${o.name}`.toLowerCase().includes(q)),
  );

  return (
    <ConfigTabs current={tab}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}

      {tab === 'marca' && brand && (
        <section className="card" aria-label="Marca de la agencia">
          <p className="cfg-help">
            ⓘ Lo vacío usa la marca de Xplore Together. Logo y colores salen en el menú, el acceso y la
            propuesta; el pie, al final de la propuesta.
          </p>
          <div className="row">
            <Logo height={48} src={brand.logoUrl} alt={brand.brandName ?? brand.name} />
            <label>
              Logo (PNG o JPG, hasta 512 KB)
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => void uploadLogo(e.currentTarget.files?.[0])}
              />
            </label>
            {brand.logoUrl && (
              <button
                type="button"
                className="secondary"
                onClick={() => run('Logo quitado', () => api('/agency/logo', { method: 'DELETE' }))}
              >
                Quitar logo
              </button>
            )}
          </div>
          <form onSubmit={saveBrand} key={JSON.stringify(brand)} className="cfg-form">
            <label>
              Nombre que se muestra
              <input
                name="brandName"
                maxLength={80}
                defaultValue={brand.brandName ?? ''}
                placeholder={brand.name}
              />
            </label>
            {(
              [
                ['primaryColor', 'Color principal', '#00457f'],
                ['accentColor', 'Color de acento (botones)', '#c2410c'],
              ] as const
            ).map(([key, label, fallback]) => (
              <fieldset key={key} className="row">
                <legend>{label}</legend>
                <label className="inline">
                  <input name={`${key}On`} type="checkbox" defaultChecked={!!brand[key]} /> Usar color propio
                </label>
                <input name={key} type="color" aria-label={label} defaultValue={brand[key] ?? fallback} />
              </fieldset>
            ))}
            <label>
              Pie de la propuesta (razón social, RNT, contacto)
              <textarea
                name="proposalFooter"
                maxLength={1000}
                rows={3}
                defaultValue={brand.proposalFooter ?? ''}
              />
            </label>
            <label>
              Nombre del remitente en los correos
              <input
                name="mailFromName"
                maxLength={80}
                defaultValue={brand.mailFromName ?? ''}
                placeholder="Igual que hoy"
              />
            </label>
            <label>
              Dominio propio (opcional)
              <input
                name="customDomain"
                maxLength={253}
                defaultValue={brand.customDomain ?? ''}
                placeholder="cotizador.tuagencia.com"
              />
            </label>
            <p className="cfg-help">
              ⓘ Conéctalo primero en Google Cloud (docs/DEPLOYMENT.md); al guardarlo, las ligas de los correos
              lo usan.
            </p>
            <button>Guardar marca</button>
          </form>
        </section>
      )}

      {tab === 'permisos' && (
        <section className="card" aria-label="Permisos por rol">
          <p className="cfg-help">
            ⓘ Ver, Crear, Editar y Borrar (cancelar) aplican en las oficinas de cada persona; nada se elimina,
            todo queda en la bitácora. Nadie autoriza una cotización que preparó. El administrador del sistema
            siempre puede todo. Las oficinas de cada persona se eligen en Usuarios.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rol</th>
                  {Object.values(FLAG).map((l) => (
                    <th key={l} className="c">
                      {l}
                    </th>
                  ))}
                  <th>Tope de autorización (MXN)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.role}>
                    <th scope="row">{ROLE_LABEL[row.role]}</th>
                    {(Object.keys(FLAG) as (keyof typeof FLAG)[]).map((k) => (
                      <td key={k} className="c">
                        <input
                          type="checkbox"
                          className="switch"
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
      )}

      {tab === 'tipos' && (
        <section className="card" aria-label="Tipos de cambio oficiales">
          <div className="cfg-bar">
            <p className="cfg-help">
              ⓘ Prellenan cada cotización, que guarda su copia con fecha y fuente. Publicar uno nuevo no
              cambia cotizaciones existentes. USD y EUR llegan solos de Banxico (FIX) cada día hábil.
            </p>
            <span className="sp" />
            <button type="button" className="secondary" onClick={() => void pullBanxico()}>
              Traer de Banxico ahora
            </button>
          </div>
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
          <form onSubmit={publishRate} className="row cfg-add">
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
      )}

      {tab === 'oficinas' && (
        <section className="card" aria-label="Oficinas">
          <div className="cfg-bar">
            <strong>
              {shownOffices.length} {shownOffices.length === 1 ? 'oficina' : 'oficinas'}
            </strong>
            <span className="cfg-help">ⓘ Con historial no se borran: se desactivan.</span>
            <span className="sp" />
            <input
              type="search"
              aria-label="Buscar oficina"
              placeholder="Buscar oficina"
              value={officeQuery}
              onChange={(e) => setOfficeQuery(e.target.value)}
            />
            <select
              aria-label="Estado de la oficina"
              value={onlyActive ? 'on' : ''}
              onChange={(e) => setOnlyActive(e.target.value === 'on')}
            >
              <option value="">Todas</option>
              <option value="on">Activas</option>
            </select>
            <button type="button" onClick={() => setAdding(!adding)} aria-expanded={adding}>
              + Agregar oficina
            </button>
          </div>
          {adding && (
            <form onSubmit={createOffice} className="row cfg-add">
              <label>
                Código
                <input name="code" required pattern="[A-Za-z0-9\-]{2,20}" maxLength={20} placeholder="MTY" />
              </label>
              <label>
                Nombre
                <input name="name" required maxLength={120} />
              </label>
              <button>Crear oficina</button>
              <button type="button" className="secondary" onClick={() => setAdding(false)}>
                Cancelar
              </button>
            </form>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th className="num">Solicitudes</th>
                  <th className="num">Privilegios</th>
                  <th className="num">Plantillas</th>
                  <th className="num">Meta {goalYear} (MXN)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shownOffices.map((o) =>
                  editing === o.id ? (
                    <tr key={o.id}>
                      <td colSpan={8}>
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
                    <tr key={o.id} className={o.active ? undefined : 'muted'}>
                      <th scope="row">{o.code}</th>
                      <td>{o.name}</td>
                      <td>
                        <span className={`badge ${o.active ? 'st-won' : ''}`}>
                          {o.active ? 'Activa' : 'Desactivada'}
                        </span>
                      </td>
                      <td className="num">{o.requests}</td>
                      <td className="num">{o.userRoles}</td>
                      <td className="num">{o.templates}</td>
                      <td className="num">
                        {money(goals?.[o.id]) ?? <span className="muted">Sin meta</span>}
                      </td>
                      <td className="cfg-acts">
                        <button
                          className="link"
                          aria-label={`Editar ${o.code}`}
                          onClick={() => setEditing(o.id)}
                        >
                          Editar
                        </button>
                        <details className="cfg-more">
                          <summary aria-label={`Más acciones de ${o.code}`}>⋯</summary>
                          <div className="card">
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
                          </div>
                        </details>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'reglas' && rules && alerts && (
        <div className="cfg-grid">
          <section className="card" aria-labelledby="reglas">
            <h2 id="reglas">Reglas de autorización</h2>
            <p className="cfg-help">
              ⓘ Dentro de los límites se autoriza sola («Regla automática»); fuera, va al comité y con margen
              bajo pide dos firmas. Margen = comisión ÷ precio del grupo.
            </p>
            <form onSubmit={saveRules} className="cfg-form">
              <label className="inline">
                <input
                  type="checkbox"
                  className="switch"
                  name="autoApprove"
                  defaultChecked={rules.autoApprove}
                />{' '}
                Autorizar automáticamente
              </label>
              <label>
                Margen mínimo (%)
                <input
                  name="autoMin"
                  type="number"
                  min={0}
                  max={99}
                  step="0.01"
                  required
                  defaultValue={Number(rules.autoMinMarginRate) * 100}
                />
              </label>
              <label>
                Total del grupo hasta (MXN)
                <input name="autoMax" inputMode="decimal" required defaultValue={rules.autoMaxGroupMxn} />
              </label>
              <label>
                Dos firmas con margen menor a (%)
                <input
                  name="twoLevel"
                  type="number"
                  min={0}
                  max={99}
                  step="0.01"
                  placeholder="Sin segunda firma"
                  defaultValue={
                    rules.twoLevelBelowMarginRate === null ? '' : Number(rules.twoLevelBelowMarginRate) * 100
                  }
                />
              </label>
              <button>Guardar reglas</button>
            </form>
          </section>
          <section className="card" aria-labelledby="alertas">
            <h2 id="alertas">Alertas de vencimiento</h2>
            <p className="cfg-help">
              ⓘ Correo diario (días hábiles, 13:00) y en Mi trabajo. 0 apaga la alerta.
            </p>
            <form onSubmit={saveAlerts} className="cfg-form">
              {ALERT_FIELDS.map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input name={key} type="number" min={0} max={180} required defaultValue={alerts[key]} />
                </label>
              ))}
              <button>Guardar alertas</button>
            </form>
          </section>
        </div>
      )}

      {tab === 'metas' && (
        <section className="card" aria-label="Meta anual por oficina">
          <div className="cfg-bar">
            <p className="cfg-help">
              ⓘ Venta en pesos por año (por fecha de cierre); se ve en el Dashboard ejecutivo. Vacío = sin
              meta.
            </p>
            <span className="sp" />
            <label className="inline">
              Año
              <input
                type="number"
                min={2020}
                max={2100}
                value={goalYear}
                onChange={(e) => setGoalYear(Number(e.target.value) || new Date().getFullYear())}
              />
            </label>
          </div>
          {goals && (
            <form key={goalYear} onSubmit={saveGoals}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Oficina</th>
                      <th>Meta {goalYear} (MXN)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offices
                      .filter((o) => o.active || goals[o.id])
                      .map((o) => (
                        <tr key={o.id}>
                          <th scope="row">
                            {o.code} · {o.name}
                          </th>
                          <td>
                            <input
                              name={o.id}
                              inputMode="decimal"
                              aria-label={`Meta ${goalYear} de ${o.code}`}
                              defaultValue={goals[o.id] ?? ''}
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <button>Guardar metas</button>
            </form>
          )}
        </section>
      )}

      {tab === 'agencias' && me?.platformAdmin && <Agencies />}

      {tab === 'integraciones' && (
        <section className="card" aria-label="Integraciones">
          <p className="cfg-help">
            ⓘ Se activan al desplegar con su llave (Secret Manager); aquí solo se ve si están configuradas.
          </p>
          <table>
            <tbody>
              {integrations.map((i) => (
                <tr key={i.key}>
                  <th scope="row">{i.name}</th>
                  <td>
                    {i.configured ? (
                      <span className="badge st-won">Configurada</span>
                    ) : i.key === 'WISSIFY' ? (
                      <span className="muted">Pendiente: Wissify aún no comparte su API</span>
                    ) : (
                      <span className="muted">No configurada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </ConfigTabs>
  );
}
