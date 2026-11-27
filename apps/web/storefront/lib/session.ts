import 'server-only';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import { COOKIE, cookieBase } from './config';

export interface Tokens { access_token: string; refresh_token: string; expires_in: number }
type Jar = Awaited<ReturnType<typeof cookies>>;

export function writeTokens(jar: Jar, t: Tokens) {
  jar.set(COOKIE.access, t.access_token, { ...cookieBase, maxAge: t.expires_in });
  jar.set(COOKIE.refresh, t.refresh_token, { ...cookieBase, maxAge: 30 * 24 * 3600 });
}
export function clearTokens(jar: Jar) { jar.delete(COOKIE.access); jar.delete(COOKIE.refresh); }

/** Identificador estável deste browser (para a lista de dispositivos da conta). */
export function deviceFingerprint(jar: Jar) {
  let id = jar.get(COOKIE.device)?.value;
  if (!id) { id = randomUUID(); jar.set(COOKIE.device, id, { ...cookieBase, maxAge: 365 * 24 * 3600 }); }
  return id;
}
