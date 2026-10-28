'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { toBase64 } from '../cotizaciones/[id]/SheetImport';
import { api, errorText } from '../lib/api';
import { fmtDateTime } from '../lib/types';

interface Attachment {
  id: string;
  fileName: string;
  size: number;
  createdAt: string;
  uploadedBy: { id: string; name: string };
}

const MAX_BYTES = 3 * 1024 * 1024;
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/** V2 "adjuntos": school letters, supplier quotes; the server sniffs the type and forces download. */
export function RequestFiles({
  requestId,
  canUpload,
  canDeleteAny,
  meId,
}: {
  requestId: string;
  canUpload: boolean;
  canDeleteAny: boolean;
  meId: string | undefined;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/requests/${requestId}/attachments`;

  const reload = useCallback(() => {
    api<Attachment[]>(base).then(setFiles, (e) => setError(errorText(e)));
  }, [base]);
  useEffect(reload, [reload]);

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = new FormData(form).get('file');
    setError(null);
    try {
      if (!(file instanceof File) || !file.size) throw new Error('Elige un archivo');
      if (file.size > MAX_BYTES) throw new Error('El archivo pesa más de 3 MB');
      setBusy(true);
      await api(base, { method: 'POST', body: { fileName: file.name, fileBase64: await toBase64(file) } });
      form.reset();
      reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Attachment) {
    setError(null);
    try {
      await api(`${base}/${a.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section aria-labelledby="archivos">
      <h2 id="archivos">Archivos</h2>
      {files.length === 0 ? (
        <p className="muted">Sin archivos.</p>
      ) : (
        <ul>
          {files.map((a) => (
            <li key={a.id}>
              <a href={`/api/v1${base}/${a.id}`} download>
                {a.fileName}
              </a>{' '}
              <span className="muted">
                · {kb(a.size)} · {a.uploadedBy.name} · {fmtDateTime(a.createdAt)}
              </span>{' '}
              {(canDeleteAny || a.uploadedBy.id === meId) && (
                <button
                  className="secondary"
                  aria-label={`Quitar ${a.fileName}`}
                  onClick={() => void remove(a)}
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <form className="row" onSubmit={upload}>
          <label>
            Agregar archivo (PDF, imagen, Excel, Word, PowerPoint, CSV; hasta 3 MB)
            <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx,.pptx,.csv,.txt" />
          </label>
          <button className="secondary" disabled={busy}>
            {busy ? 'Subiendo…' : 'Subir'}
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
