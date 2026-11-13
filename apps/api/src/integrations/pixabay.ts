/**
 * Free stock photos for the proposal (Will, 2026-11-13), from the Pixabay API (https://pixabay.com/api/docs/).
 * Pexels paused new API keys (2026-11), so Pixabay it is. Its rules: cache responses 24 h, no permanent
 * hotlinking (we copy the chosen photo to our server) and show where the photos come from (the picker and
 * the proposal say "Pixabay").
 */
export interface StockPhoto {
  id: number;
  /** Preview for the picker; Pixabay allows showing its URLs temporarily in search results. */
  thumb: string;
  alt: string;
  photographer: string;
  /** The photo's page on Pixabay. */
  url: string;
}

export interface StockPhotos {
  search(query: string, page: number): Promise<{ photos: StockPhoto[]; hasNext: boolean }>;
  /** JPEG bytes of the photo at proposal size (up to 1280 px), plus the credit line to keep with it. */
  download(id: number): Promise<{ content: Buffer<ArrayBuffer>; credit: string }>;
}
export const STOCK_PHOTOS = Symbol('STOCK_PHOTOS');

export class StockPhotoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface PixabayHit {
  id?: number;
  pageURL?: string;
  tags?: string;
  user?: string;
  webformatURL?: string;
  largeImageURL?: string;
}
interface PixabayResponse {
  totalHits?: number;
  hits?: PixabayHit[];
}

/** Only Pixabay's own https hosts are ever fetched or shown, whatever the response says. */
export const pixabayImage = (u: string | undefined): string | null => {
  try {
    const url = new URL(u ?? '');
    return url.protocol === 'https:' &&
      (url.hostname === 'pixabay.com' || url.hostname.endsWith('.pixabay.com'))
      ? url.href
      : null;
  } catch {
    return null;
  }
};

export function toStockPhoto(h: PixabayHit): StockPhoto | null {
  const thumb = pixabayImage(h.webformatURL);
  if (typeof h.id !== 'number' || !thumb) return null;
  return {
    id: h.id,
    thumb,
    alt: (h.tags ?? '').slice(0, 200),
    photographer: (h.user ?? 'Pixabay').slice(0, 100),
    url: h.pageURL?.startsWith('https://pixabay.com/') ? h.pageURL : 'https://pixabay.com/',
  };
}

const PER_PAGE = 12;
const MAX_BYTES = 3 * 1024 * 1024;
const DAY = 86_400_000;

export class HttpPixabay implements StockPhotos {
  private readonly base = 'https://pixabay.com/api/';
  // Pixabay asks to cache answers for 24 h. shortcut: in-memory per instance, 500 entries; fine for a few users.
  private readonly cache = new Map<string, { at: number; body: PixabayResponse }>();
  constructor(private readonly apiKey: string) {}

  private async get(params: Record<string, string>): Promise<PixabayResponse> {
    const key = JSON.stringify(params);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < DAY) return hit.body;
    const q = new URLSearchParams({ key: this.apiKey, ...params });
    const res = await fetch(`${this.base}?${q}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok)
      throw new StockPhotoError(
        res.status === 429 ? 429 : 502,
        res.status === 429
          ? 'Pixabay: demasiadas búsquedas seguidas; intenta en un minuto'
          : `Pixabay respondió ${res.status}`,
      );
    const body = (await res.json()) as PixabayResponse;
    if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), body });
    return body;
  }

  async search(query: string, page: number) {
    const body = await this.get({
      q: query.slice(0, 100),
      lang: 'es',
      image_type: 'photo',
      orientation: 'horizontal',
      safesearch: 'true',
      per_page: String(PER_PAGE),
      page: String(page),
    });
    return {
      photos: (body.hits ?? []).map(toStockPhoto).filter((p): p is StockPhoto => !!p),
      hasNext: page * PER_PAGE < (body.totalHits ?? 0),
    };
  }

  async download(id: number) {
    const h = (await this.get({ id: String(id) })).hits?.[0];
    const src = pixabayImage(h?.largeImageURL);
    if (!h || !src) throw new StockPhotoError(502, 'Pixabay no devolvió la foto');
    const res = await fetch(src, { signal: AbortSignal.timeout(20_000) });
    const content = Buffer.from(await res.arrayBuffer());
    if (!res.ok || !content.length || content.length > MAX_BYTES)
      throw new StockPhotoError(502, 'No se pudo descargar la foto de Pixabay');
    return { content, credit: `${(h.user ?? 'Pixabay').slice(0, 100)} / Pixabay` };
  }
}
