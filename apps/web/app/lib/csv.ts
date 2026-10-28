/** RFC 4180 cell, with a leading quote on cells Excel would run as a formula (same rule as the API). */
const cell = (v: string | number) => {
  if (typeof v === 'number') return String(v);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** Saves rows as a CSV that Excel opens with accents intact (UTF-8 BOM). */
export function downloadCsv(fileName: string, rows: (string | number)[][]) {
  const text = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  URL.revokeObjectURL(url);
}
