import { getDeviceId } from './session';

export class ApiError extends Error {
  constructor(message: string, public status: number, public network = false) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setToken(t: string | null) {
  token = t;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: {
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-device-id': getDeviceId(),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError('لا يوجد اتصال بالخادم', 0, true);
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    // 502/503/504 من وسيط = الخادم غير متاح
    if (res.status >= 502 && res.status <= 504) throw new ApiError('الخادم غير متاح حاليًا', res.status, true);
    throw new ApiError(data?.error ?? `خطأ ${res.status}`, res.status);
  }
  return data as T;
}
