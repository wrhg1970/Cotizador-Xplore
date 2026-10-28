'use client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { path?: string; message: string }[] = [],
  ) {
    super(message);
  }
}

/** Pages anyone may open without a session: the landing, login and the school's proposal link. */
export const isPublicPath = (path: string) =>
  path === '/' || path.startsWith('/login') || path.startsWith('/p/');

/** Same-origin call to the API (proxied by next.config rewrites); the session cookie rides along. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  if (res.status === 401 && typeof window !== 'undefined' && !isPublicPath(window.location.pathname)) {
    window.location.assign('/login');
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: [] };
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? 'Error inesperado', err.details ?? []);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const errorText = (e: unknown) =>
  e instanceof ApiError
    ? e.details.length
      ? e.details.map((d) => d.message).join(' · ')
      : e.message
    : 'No se pudo conectar con el servidor';
