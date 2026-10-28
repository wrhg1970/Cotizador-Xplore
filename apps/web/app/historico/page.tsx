'use client';

import type { ImportHistory } from '@ee/contracts';
import Link from 'next/link';
import { type ChangeEvent, useEffect, useState } from 'react';
import { MAX_BYTES, toBase64 } from '../cotizaciones/[id]/SheetImport';
import { api, errorText } from '../lib/api';

interface Office {
  id: string;
  code: string;
  name: string;
}

type Preview = Omit<ImportHistory, 'officeId' | 'sourceFile' | 'outcome' | 'sentOn' | 'chaperones'> & {
  groupName: string | null;
  city: string | null;
  countryCode: string | null;
  departureDate: string | null;
  returnDate: string | null;
  officeId: string | null;
  officeName: string | null;
  warnings: string[];
};

interface Row {
  file: string;
  preview?: Preview;
  error?: string;
  officeId: string;
  outcome: ImportHistory['outcome'];
  wonOption: number;
  lostReason: string;
  sentOn: string;
  done?: { id: string; folio: string };
  busy?: boolean;
}

const MISSING: [keyof Preview, string][] = [
  ['groupName', 'nombre del grupo'],
  ['city', 'ciudad o país'],
  ['countryCode', 'país'],
  ['departureDate', 'fecha de salida'],
  ['returnDate', 'fecha de regreso'],
];

/** Historic migration: last year's EE workbooks become closed requests (system admin only). */
export default function HistoryPage() {
  const [offices, setOffices] = useState<Office[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    api<Office[]>('/offices').then(setOffices, () => setOffices([]));
  }, []);

  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    const start = rows.length;
    setRows((rs) => [
      ...rs,
      ...files.map((f) => ({
        file: f.name,
        officeId: '',
        outcome: 'WON' as const,
        wonOption: 0,
        lostReason: '',
        sentOn: '',
      })),
    ]);
    for (const [k, f] of files.entries()) {
      try {
        if (f.size > MAX_BYTES) throw new Error('El archivo pesa más de 3 MB');
        const p = await api<Preview>('/history/preview', {
          method: 'POST',
          body: { fileName: f.name, fileBase64: await toBase64(f) },
        });
        patch(start + k, { preview: p, officeId: p.officeId ?? '', sentOn: p.departureDate ?? '' });
      } catch (err) {
        patch(start + k, { error: errorText(err) });
      }
    }
    e.target.value = '';
  }

  async function save(i: number) {
    const r = rows[i]!;
    const p = r.preview!;
    patch(i, { busy: true, error: undefined });
    try {
      const done = await api<{ id: string; folio: string }>('/history', {
        method: 'POST',
        body: {
          officeId: r.officeId,
          sourceFile: r.file,
          groupName: p.groupName,
          clientName: p.clientName ?? undefined,
          program: p.program ?? undefined,
          city: p.city,
          countryCode: p.countryCode,
          departureDate: p.departureDate,
          returnDate: p.returnDate,
          staff: p.staff,
          options: p.options,
          outcome: r.outcome,
          ...(r.outcome === 'WON' && { wonOption: r.wonOption }),
          ...(r.outcome === 'LOST' && { lostReason: r.lostReason }),
          sentOn: r.sentOn,
        },
      });
      patch(i, { done, busy: false });
    } catch (err) {
      patch(i, { error: errorText(err), busy: false });
    }
  }

  return (
    <>
      <p>
        <Link href="/administracion">← Administración</Link>
      </p>
      <h1>Importar histórico</h1>
      <p className="muted">
        Sube los Excel de cotización del formato EE (pestañas “Consolidado” y “Opción N”). Cada archivo se
        vuelve una solicitud cerrada con sus opciones enviadas, para que Colegios, el Dashboard y la meta
        anual tengan datos. Se toma el precio final de cada opción, sin el desglose de costos.
      </p>
      <label className="card" style={{ display: 'block' }}>
        Archivos .xlsx
        <input type="file" accept=".xlsx" multiple onChange={(e) => void pick(e)} />
      </label>

      {rows.map((r, i) => {
        const p = r.preview;
        const missing = p ? MISSING.filter(([k]) => !p[k]).map(([, label]) => label) : [];
        const ready = p && !missing.length && p.options.length > 0 && r.officeId && r.sentOn;
        return (
          <section key={`${r.file}-${i}`} className="card" style={{ marginTop: 16 }} aria-label={r.file}>
            <h2 style={{ marginTop: 0 }}>{p?.groupName ?? r.file}</h2>
            {!p && !r.error && <p className="muted">Leyendo {r.file}…</p>}
            {p && (
              <>
                <p className="muted">
                  {r.file} · {p.clientName ?? 'Sin cliente'} · {p.city ?? '¿?'} ({p.countryCode ?? '¿?'}) ·{' '}
                  {p.departureDate ?? '¿?'} a {p.returnDate ?? '¿?'} · {p.options.length} opciones
                </p>
                {missing.length > 0 && <p className="error">Falta en el Excel: {missing.join(', ')}.</p>}
                {p.warnings.map((w) => (
                  <p key={w} className="error">
                    {w}
                  </p>
                ))}
                {r.done ? (
                  <p role="status">
                    Importada como <Link href={`/solicitudes/${r.done.id}`}>{r.done.folio}</Link>.
                  </p>
                ) : (
                  <div className="row">
                    <label>
                      Oficina{p.officeName && !p.officeId ? ` (el Excel dice “${p.officeName}”)` : ''}
                      <select value={r.officeId} onChange={(e) => patch(i, { officeId: e.target.value })}>
                        <option value="">Elige…</option>
                        {offices.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.code} · {o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Resultado
                      <select
                        value={r.outcome}
                        onChange={(e) => patch(i, { outcome: e.target.value as Row['outcome'] })}
                      >
                        <option value="WON">Ganada</option>
                        <option value="LOST">Perdida</option>
                        <option value="SENT">Enviada, sin resultado</option>
                      </select>
                    </label>
                    {r.outcome === 'WON' && (
                      <label>
                        Opción ganadora
                        <select
                          value={r.wonOption}
                          onChange={(e) => patch(i, { wonOption: Number(e.target.value) })}
                        >
                          {p.options.map((o, k) => (
                            <option key={o.name} value={k}>
                              {o.name}: {o.pricePerParticipant} {o.saleCurrency} × {o.participants}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {r.outcome === 'LOST' && (
                      <label>
                        Motivo
                        <input
                          value={r.lostReason}
                          maxLength={500}
                          onChange={(e) => patch(i, { lostReason: e.target.value })}
                        />
                      </label>
                    )}
                    <label>
                      Fecha de envío
                      <input
                        type="date"
                        value={r.sentOn}
                        onChange={(e) => patch(i, { sentOn: e.target.value })}
                      />
                    </label>
                    <button disabled={!ready || r.busy} onClick={() => void save(i)}>
                      {r.busy ? 'Importando…' : 'Importar'}
                    </button>
                  </div>
                )}
              </>
            )}
            {r.error && (
              <p className="error" role="alert">
                {r.error}
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}
