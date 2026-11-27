import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL, COOKIE, DEFAULT_COUNTRY } from './config';

export class ApiError extends Error {
  constructor(public status: number, public body: any) { super(body?.message ? String(body.message) : `API ${status}`); }
}

export interface ApiOpts { method?: string; body?: unknown; idempotencyKey?: string; token?: string | null }

/** Chamada servidor→API. O token vem do cookie httpOnly; o browser nunca o vê. */
export async function api<T = any>(path: string, o: ApiOpts = {}): Promise<T> {
  const token = o.token === undefined ? (await cookies()).get(COOKIE.access)?.value : o.token;
  const h = await headers();
  const res = await fetch(`${API_URL}/v1${path}`, {
    method: o.method ?? (o.body ? 'POST' : 'GET'), cache: 'no-store',
    headers: {
      'content-type': 'application/json', 'x-country': h.get('cf-ipcountry') ?? DEFAULT_COUNTRY,
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(o.idempotencyKey ? { 'idempotency-key': o.idempotencyKey } : {}),
    },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  const text = await res.text(); let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Para páginas que exigem sessão: em 401 tenta renovar (route handler) e volta; se já tentou há instantes, vai para o login. */
export async function authed<T = any>(path: string, next: string, o: ApiOpts = {}): Promise<T> {
  const jar = await cookies();
  if (!jar.get(COOKIE.access) && !jar.get(COOKIE.refresh)) redirect(`/login?next=${encodeURIComponent(next)}`);
  try { return await api<T>(path, o); }
  catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(jar.get(COOKIE.refreshed) ? `/login?next=${encodeURIComponent(next)}` : `/api/auth/refresh?next=${encodeURIComponent(next)}`);
    throw e;
  }
}

/** Para páginas de portal: devolve o resultado em vez de lançar, para mostrar "sem permissões"/"ative o MFA" em vez de uma página de erro. */
export type Safe<T> = { ok: true; data: T } | { ok: false; status: number; code?: string; message: string };
export async function safe<T = any>(path: string, next: string, o: ApiOpts = {}): Promise<Safe<T>> {
  try { return { ok: true, data: await authed<T>(path, next, o) }; }
  catch (e) { if (e instanceof ApiError) return { ok: false, status: e.status, code: e.body?.code, message: e.message }; throw e; }
}

export async function currentUser() {
  const jar = await cookies();
  if (!jar.get(COOKIE.access) && !jar.get(COOKIE.refresh)) return null;
  try { return await api<{ id: string; email: string; display_name: string; country_code: string; roles: string[]; is_admin: boolean; mfa_enabled: boolean }>('/users/me'); } catch { return null; }
}
