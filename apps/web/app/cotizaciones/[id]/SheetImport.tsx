'use client';

import { type FormEvent, useState } from 'react';
import { api, errorText } from '../../lib/api';
import { type ItineraryDayDto, type QuoteLineDto, SHEET_BLOCKS } from '../../lib/types';

export interface ImportProposal {
  summary: string;
  lines: QuoteLineDto[];
  targetMarginRate: string | null;
  itinerary: ItineraryDayDto[];
  exclusions: string[];
  warnings: string[];
}

export const MAX_BYTES = 3 * 1024 * 1024;
const BLOCK = Object.fromEntries(SHEET_BLOCKS.map((b) => [b.category, b.title]));

export const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '');
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });

/** Reads a cost sheet with AI and lets the quoter review the proposal before it touches the editor. */
export function SheetImport({
  quoteId,
  onApply,
}: {
  quoteId: string;
  onApply: (p: ImportProposal, mode: 'replace' | 'append') => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ImportProposal | null>(null);

  async function read(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get('file');
    const sheetUrl = String(f.get('sheetUrl') ?? '').trim();
    setError(null);
    setProposal(null);
    try {
      let body: object;
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_BYTES) throw new Error('El archivo pesa más de 3 MB');
        body = { fileName: file.name, fileBase64: await toBase64(file) };
      } else if (sheetUrl) body = { sheetUrl };
      else throw new Error('Elige un archivo o pega una liga de Google Sheets');
      setBusy(true);
      setProposal(await api<ImportProposal>(`/quotes/${quoteId}/import`, { method: 'POST', body }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const apply = (mode: 'replace' | 'append') => {
    onApply(proposal!, mode);
    setProposal(null);
  };

  return (
    <section aria-labelledby="importar">
      <h2 id="importar">Importar desde una hoja</h2>
      <p className="muted">
        La IA lee una hoja de costos y propone los conceptos. Nada se guarda hasta que lo revises y pulses
        “Guardar y calcular”. Los tipos de cambio se capturan aparte, como siempre.
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
      {proposal && (
        <div className="card" style={{ marginTop: 12 }}>
          {proposal.summary && <p style={{ marginTop: 0 }}>{proposal.summary}</p>}
          {proposal.warnings.length > 0 && (
            <ul className="error">
              {proposal.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {proposal.lines.length === 0 ? (
            <p className="muted">No se encontraron conceptos.</p>
          ) : (
            <div className="table-wrap">
              <table aria-label="Conceptos propuestos">
                <thead>
                  <tr>
                    <th>Bloque</th>
                    <th>Concepto</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Costo unitario</th>
                    <th>Moneda</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{BLOCK[l.category]}</td>
                      <td>
                        {l.description}
                        {l.internalOnly && <span className="muted"> (interno)</span>}
                      </td>
                      <td className="num">{l.quantity}</td>
                      <td className="num">{l.unitCost}</td>
                      <td>{l.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">
            {proposal.targetMarginRate &&
              `% de comisión detectado: ${Number((Number(proposal.targetMarginRate) * 100).toFixed(4))}%. `}
            {proposal.itinerary.length > 0 && `Itinerario: ${proposal.itinerary.length} días. `}
            {proposal.exclusions.length > 0 && `No incluye: ${proposal.exclusions.length} puntos.`}
          </p>
          <div className="row">
            <button type="button" disabled={!proposal.lines.length} onClick={() => apply('replace')}>
              Reemplazar conceptos
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!proposal.lines.length}
              onClick={() => apply('append')}
            >
              Agregar a los conceptos
            </button>
            <button type="button" className="secondary" onClick={() => setProposal(null)}>
              Descartar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
