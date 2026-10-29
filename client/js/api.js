// Thin fetch wrapper. Identity is the HttpOnly session cookie; the CSRF token is sent on every state-changing call.
let csrfToken = null;
export const setCsrf = (t) => { csrfToken = t; };
export const bus = new EventTarget();

export class ApiError extends Error {
  constructor(status, body) {
    const err = body?.error ?? {};
    super(err.message ?? 'Something went wrong. Please try again.');
    this.status = status; this.code = err.code ?? 'error'; this.details = err.details ?? null;
  }
  // field -> message map for showing errors next to inputs
  get fieldErrors() {
    const out = {};
    if (Array.isArray(this.details)) for (const d of this.details) if (d?.field && !out[d.field]) out[d.field] = d.message;
    return out;
  }
}

export async function api(method, path, body, { signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  let res;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', signal,
      body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, { error: { code: 'network_error', message: 'Cannot reach the server. Check your connection and try again.' } });
  }
  if (res.status === 204) return { data: null };
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) bus.dispatchEvent(new CustomEvent('unauthorized'));
    throw new ApiError(res.status, json);
  }
  return json;
}

export const get = (p, o) => api('GET', p, undefined, o);
export const post = (p, b) => api('POST', p, b ?? undefined);
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p, b) => api('DELETE', p, b);
export const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString(); return s ? `?${s}` : '';
};
