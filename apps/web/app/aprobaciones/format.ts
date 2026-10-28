const n2 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,935,679.05 EUR"; amounts come as decimal strings from the API. */
export const amount = (x: string | null | undefined, currency: string) =>
  x ? `${n2.format(Number(x))} ${currency}` : '—';

/** "0.2100" → "21.00%". */
export const rate = (x: string | null | undefined) => (x ? `${n2.format(Number(x) * 100)}%` : '—');
