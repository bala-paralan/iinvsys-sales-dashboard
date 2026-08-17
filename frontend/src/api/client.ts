/**
 * The API client. Every request in the app goes through here — the legacy
 * app's 15-line wrapper grew informal call sites (raw fetch for uploads, no
 * 401 handling, `res.json()` before checking `res.ok` so a 502 surfaced as a
 * JSON parse error). This one is still small, but the failure modes are
 * handled once, centrally.
 */

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  /* gate failures (422 from /advance) */
  code?: string;
  missing?: GateRequirementFailure[];
  pagination?: { total: number; page: number; limit: number; pages: number };
}

export interface GateRequirementFailure {
  field: string;
  test: string;
  code: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  missing?: GateRequirementFailure[];

  constructor(status: number, message: string, code?: string, missing?: GateRequirementFailure[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.missing = missing;
  }
}

/**
 * Token lives in module memory with sessionStorage persistence so a reload
 * within the tab survives.
 *
 * KNOWN INTERIM STATE: the plan (10-frontend-architecture.md) calls for an
 * httpOnly refresh cookie with the access token in memory only. The backend
 * does not issue refresh cookies yet — that lands with the N-8 auth work.
 * sessionStorage is strictly narrower than the legacy localStorage (dies with
 * the tab, invisible to other tabs), and this module is the single place to
 * change when the cookie flow exists.
 */
const TOKEN_KEY = 'iinvsys.token';
let token: string | null = sessionStorage.getItem(TOKEN_KEY);

export function setToken(next: string | null): void {
  token = next;
  if (next === null) sessionStorage.removeItem(TOKEN_KEY);
  else sessionStorage.setItem(TOKEN_KEY, next);
}

export function hasToken(): boolean {
  return token !== null;
}

/** For the download helper, which needs the raw header rather than a JSON call. */
export function getToken(): string | null {
  return token;
}

/** Called by the session layer so a 401 routes to login instead of a toast. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/** Multipart upload — FormData sets its own boundary, so no Content-Type. */
export async function apiUpload<T>(path: string, form: FormData): Promise<ApiEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the API running?');
  }
  let payload: ApiEnvelope<T> | null = null;
  try { payload = (await res.json()) as ApiEnvelope<T>; } catch { payload = null; }
  if (!res.ok || payload === null || payload.success === false) {
    throw new ApiError(res.status, payload?.message ?? `Upload failed (${res.status})`,
      payload?.code, payload?.missing);
  }
  return payload;
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    /* The server never answered — name that, rather than pretending it is a
       credentials or validation problem. (The legacy login banner said
       "Invalid credentials" for exactly this case.) */
    throw new ApiError(0, 'Cannot reach the server. Is the API running?');
  }

  /* Check ok BEFORE parsing: an nginx 502 body is HTML, and parsing it first
     replaces the real status with a JSON syntax error. */
  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    payload = null;
  }

  if (res.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new ApiError(401, payload?.message ?? 'Session expired — sign in again');
  }

  if (!res.ok || payload === null || payload.success === false) {
    throw new ApiError(
      res.status,
      payload?.message ?? `Request failed (${res.status})`,
      payload?.code,
      payload?.missing,
    );
  }

  return payload;
}
