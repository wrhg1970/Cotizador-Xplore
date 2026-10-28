'use client';

import type { RequestDraft } from '@ee/contracts';
import { type FormEvent, useState } from 'react';
import { MAX_BYTES, toBase64 } from '../cotizaciones/[id]/SheetImport';
import { api, errorText } from '../lib/api';

/** Reads a request sheet with AI and fills the form below; nothing is saved until "Guardar borrador". */
export function RequestImport({ onDraft }: { onDraft: (draft: RequestDraft) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ filled: number; warnings: string[] } | null>(null);

  async function read(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get('file');
    const sheetUrl = String(f.get('sheetUrl') ?? '').trim();
    setError(null);
    setResult(null);
    try {
      let body: object;
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_BYTES) throw new Error('El archivo pesa más de 3 MB');
        body = { fileName: file.name, fileBase64: await toBase64(file) };
      } else if (sheetUrl) body = { sheetUrl };
      else throw new Error('Elige un archivo o pega una liga de Google Sheets');
      setBusy(true);
      const res = await api<{ draft: RequestDraft; warnings: string[] }>('/requests/import', {
        method: 'POST',
        body,
      });
      onDraft(res.draft);
      setResult({ filled: Object.keys(res.draft).length, warnings: res.warnings });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card" style={{ marginBottom: 16 }}>
      <summary>Importar desde un Excel o Google Sheets</summary>
      <p className="muted">
        La IA lee la hoja y llena los campos que encuentre. Revisa el formulario y elige la oficina antes de
        guardar; nada se guarda hasta que pulses “Guardar borrador”.
      </p>
      <form className="row" onSubmit={read}>
        <label>
          Archivo .xlsx o .csv
          <input name="file" type="file" accept=".xlsx,.csv" />
        </label>
        <label>
          o liga de Google Sheets (compartida con enlace)
          <input
            name="sheetUrl"
            type="url"
            maxLength={500}
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
        </label>
        <button className="secondary" disabled={busy}>
          {busy ? 'Leyendo…' : 'Leer hoja'}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div role="status">
          <p>
            {result.filled
              ? `Se llenaron ${result.filled} campos. Revisa el formulario.`
              : 'No se encontraron datos de la solicitud en la hoja.'}
          </p>
          {result.warnings.length > 0 && (
            <ul className="error">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}
