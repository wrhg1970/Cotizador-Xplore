/**
 * Free stock photos for the proposal (Will, 2026-11-13), from the Pexels API (https://www.pexels.com/api/documentation/).
 * GET /v1/search and GET /v1/photos/:id with the key in `Authorization`. The license allows commercial use and
 * keeping a copy; the API guidelines ask to credit Pexels and the photographer, which the proposal does.
 */
export interface StockPhoto {
  id: number;
  /** Small preview for the picker, served by Pexels' CDN. */
  thumb: string;
  alt: string;
  photographer: string;
  /** The photo's page on Pexels. */
  url: string;
}

export interface StockPhotos {
  search(query: string, page: number): Promise<{ photos: StockPhoto[]; hasNext: boolean }>;
  /** JPEG bytes of the photo at proposal size, plus the credit line to keep with it. */
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

interface PexelsPhoto {
  id?: number;
  url?: string;
  alt?: string;
  photographer?: string;
  src?: { large2x?: string; large?: string; medium?: string };
}

/** Only Pexels' own image host is ever fetched or shown, whatever the response says. */
export const pexelsImage = (u: string | undefined): string | null => {
  try {
    const url = new URL(u ?? '');
    return url.protocol === 'https:' && url.hostname === 'images.pexels.com' ? url.href : null;
  } catch {
    return null;
  }
};

export function toStockPhoto(p: PexelsPhoto): StockPhoto | null {
  const thumb = pexelsImage(p.src?.medium);
  if (typeof p.id !== 'number' || !thumb) return null;
  return {
    id: p.id,
    thumb,
    alt: (p.alt ?? '').slice(0, 200),
    photographer: (p.photographer ?? 'Pexels').slice(0, 100),
    url: p.url?.startsWith('https://www.pexels.com/') ? p.url : 'https://www.pexels.com/',
  };
}

const MAX_BYTES = 3 * 1024 * 1024;

export class HttpPexels implements StockPhotos {
  private readonly base = 'https://api.pexels.com/v1';
  constructor(private readonly apiKey: string) {}

  private async get(path: string): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { Authorization: this.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok)
      throw new StockPhotoError(
        res.status === 429 ? 429 : 502,
        res.status === 429
          ? 'Pexels: se alcanzó el límite de búsquedas por hora; intenta más tarde'
          : `Pexels respondió ${res.status}`,
      );
    return res.json();
  }

  async search(query: string, page: number) {
    const q = new URLSearchParams({ query, page: String(page), per_page: '12', orientation: 'landscape' });
    const body = (await this.get(`/search?${q}`)) as { photos?: PexelsPhoto[]; next_page?: string };
    return {
      photos: (body.photos ?? []).map(toStockPhoto).filter((p): p is StockPhoto => !!p),
      hasNext: !!body.next_page,
    };
  }

  async download(id: number) {
    const p = (await this.get(`/photos/${id}`)) as PexelsPhoto;
    const src = pexelsImage(p.src?.large2x) ?? pexelsImage(p.src?.large);
    if (!src) throw new StockPhotoError(502, 'Pexels no devolvió la foto');
    // Accept JPEG only, so the CDN does not answer WebP (the PDF and our MIME allowlist want JPEG).
    const res = await fetch(src, { headers: { Accept: 'image/jpeg' }, signal: AbortSignal.timeout(20_000) });
    const content = Buffer.from(await res.arrayBuffer());
    if (!res.ok || !content.length || content.length > MAX_BYTES)
      throw new StockPhotoError(502, 'No se pudo descargar la foto de Pexels');
    return { content, credit: `${(p.photographer ?? 'Pexels').slice(0, 100)} / Pexels` };
  }
}
