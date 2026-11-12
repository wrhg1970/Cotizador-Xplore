'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/** A drop-down filter: URL key, label, and [value, text] options ("" = Todos is added). */
export interface TraySelect {
  key: string;
  label: string;
  options: (readonly [string, string])[];
}
/** A check-box filter stored as `key=1`. */
export type TrayCheck = readonly [key: string, label: string];

/** Lower-case and without accents, so "leon" finds "León". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
/** True when every word of the search appears in one of the texts. */
export const matchesSearch = (q: string, texts: (string | null | undefined)[]) => {
  const hay = fold(texts.filter(Boolean).join(' '));
  return fold(q)
    .split(/\s+/)
    .every((w) => hay.includes(w));
};

/** Offices present in the rows, for the Oficina filter (value = office code). */
export const officeOptions = (rows: { officeCode: string; officeName: string }[]) =>
  [...new Map(rows.map((r) => [r.officeCode, `${r.officeCode} · ${r.officeName}`]))].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

/** Search + "Filtros avanzados" like Cotizaciones, for Aprobaciones, Enviadas and Vendidas; state lives in the URL. */
export function TrayFilters({
  placeholder,
  selects,
  checks,
  shown,
  total,
}: {
  placeholder: string;
  selects: TraySelect[];
  checks: TrayCheck[];
  shown: number | null;
  total: number | null;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const keys = [...selects.map((s) => s.key), ...checks.map(([k]) => k)];
  const active = keys.filter((k) => params.get(k)).length;
  const [open, setOpen] = useState(active > 0);
  const [q, setQ] = useState(params.get('q') ?? '');

  const go = (change: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(change)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    router.replace(s ? `${path}?${s}` : path, { scroll: false });
  };
  const clear = () => {
    setQ('');
    go(Object.fromEntries(['q', ...keys].map((k) => [k, ''])));
  };

  return (
    <section className="card tray-filters" aria-label="Filtros">
      <div className="top">
        {shown !== null && total !== null && (
          <span className="muted count" aria-live="polite">
            Mostrando {shown} de {total}
          </span>
        )}
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() });
          }}
        >
          <input
            type="search"
            aria-label="Buscar"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              // Clearing the box with its ✕ shows everything again without pressing Enter.
              if (!e.target.value) go({ q: '' });
            }}
            placeholder={placeholder}
            maxLength={100}
          />
        </form>
        <button
          type="button"
          className="secondary"
          aria-expanded={open}
          aria-controls="filtros-avanzados"
          onClick={() => setOpen(!open)}
        >
          Filtros avanzados
          {active > 0 && <span className="tab-count">{active}</span>}
        </button>
      </div>
      {open && (
        <div id="filtros-avanzados" className="adv">
          {selects.map((s) => (
            <label key={s.key}>
              {s.label}
              <select value={params.get(s.key) ?? ''} onChange={(e) => go({ [s.key]: e.target.value })}>
                <option value="">Todos</option>
                {s.options.map(([v, text]) => (
                  <option key={v} value={v}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {checks.map(([k, label]) => (
            <label key={k} className="check">
              <input
                type="checkbox"
                checked={params.get(k) === '1'}
                onChange={(e) => go({ [k]: e.target.checked ? '1' : '' })}
              />
              {label}
            </label>
          ))}
          {(active > 0 || params.get('q')) && (
            <button type="button" className="link" onClick={clear}>
              Limpiar filtros
            </button>
          )}
        </div>
      )}
    </section>
  );
}
