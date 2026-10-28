/**
 * Banxico SIE API (https://www.banxico.org.mx/SieAPIRest/service/v1/doc/consultaDatosSerieRango):
 * GET {base}/series/{ids}/datos/oportuno with header Bmx-Token returns the latest value per series,
 * dates as dd/mm/yyyy and values like "18.1234" (or "N/E" when not published).
 */
export const BANXICO_SERIES = {
  SF43718: { fromCurrency: 'USD', source: 'Banxico FIX (SIE SF43718)' },
  SF46410: { fromCurrency: 'EUR', source: 'Banxico EUR (SIE SF46410)' },
} as const;
type SeriesId = keyof typeof BANXICO_SERIES;

export interface BanxicoRate {
  fromCurrency: string;
  toCurrency: 'MXN';
  rate: string;
  rateDate: string;
  source: string;
}

/** Seam for tests; null in the container means no token was configured. */
export interface Banxico {
  latest(): Promise<BanxicoRate[]>;
}
export const BANXICO = Symbol('BANXICO');

interface SieResponse {
  bmx?: { series?: { idSerie: string; datos?: { fecha: string; dato: string }[] }[] };
}

export function parseSie(body: SieResponse): BanxicoRate[] {
  return (body.bmx?.series ?? []).flatMap((s) => {
    const meta = BANXICO_SERIES[s.idSerie as SeriesId];
    const last = s.datos?.at(-1);
    const m = last?.fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const rate = last?.dato.replace(/,/g, '');
    if (!meta || !m || !rate || !/^\d+(\.\d+)?$/.test(rate) || Number(rate) <= 0) return [];
    return [
      {
        fromCurrency: meta.fromCurrency,
        toCurrency: 'MXN' as const,
        rate,
        rateDate: `${m[3]}-${m[2]}-${m[1]}`,
        source: meta.source,
      },
    ];
  });
}

export class HttpBanxico implements Banxico {
  constructor(
    private readonly token: string,
    private readonly base = 'https://www.banxico.org.mx/SieAPIRest/service/v1',
  ) {}

  async latest(): Promise<BanxicoRate[]> {
    const ids = Object.keys(BANXICO_SERIES).join(',');
    const res = await fetch(`${this.base}/series/${ids}/datos/oportuno`, {
      headers: { 'Bmx-Token': this.token, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Banxico respondió ${res.status}`);
    return parseSie((await res.json()) as SieResponse);
  }
}
