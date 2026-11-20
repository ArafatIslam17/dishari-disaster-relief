/** HTTP client: access token in memory only; the refresh token lives in an httpOnly cookie. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
    public readonly issues?: { path: string; message: string }[],
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function hasAccessToken(): boolean {
  return accessToken !== null;
}
/** Called when the server says the session is over (refresh failed). */
export function onSessionExpired(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Relief-Client': '1' },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { accessToken: string };
    accessToken = body.accessToken;
    return true;
  } catch {
    return false;
  }
}

/** One refresh at a time, shared by concurrent callers. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  raw?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function send(path: string, opts: Options): Promise<Response> {
  const headers: Record<string, string> = { 'X-Relief-Client': '1' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  opts.signal?.addEventListener('abort', () => controller.abort());
  try {
    return await fetch(path, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'network');
  } finally {
    clearTimeout(timer);
  }
}

async function toError(res: Response): Promise<ApiError> {
  let body: { code?: string; details?: Record<string, unknown>; issues?: { path: string; message: string }[] } = {};
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const code = res.status === 429 ? 'rate_limited' : (body.code ?? (res.status >= 500 ? 'unexpected' : 'forbidden'));
  return new ApiError(res.status, code, body.details, body.issues);
}

export async function request<T>(path: string, opts: Options = {}): Promise<T> {
  let res = await send(path, opts);
  if (res.status === 401 && path !== '/api/auth/login') {
    if (await refreshSession()) res = await send(path, opts);
    else listeners.forEach((fn) => fn());
  }
  if (!res.ok) throw await toError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Downloads a generated file (CSV/PDF) through the authenticated client. */
export async function downloadFile(path: string): Promise<{ empty: boolean }> {
  const res = await request<Response>(path, { raw: true, timeoutMs: 120_000 });
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { empty: res.headers.get('X-Report-Empty') === 'true' };
}
