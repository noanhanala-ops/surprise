import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { API_URL, COOKIE, cookieBase } from '@/lib/config';
import { safeNext } from '@/lib/format';
import { clearTokens, writeTokens, Tokens } from '@/lib/session';

/** Renova o par de tokens (rotação) e volta à página pedida. Falha ⇒ limpa a sessão e vai para o login. */
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  const jar = await cookies(); const rt = jar.get(COOKIE.refresh)?.value;
  const login = NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, req.url));
  if (!rt) return login;
  const r = await fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }), cache: 'no-store' });
  if (!r.ok) { clearTokens(jar); return login; }
  writeTokens(jar, (await r.json()) as Tokens);
  jar.set(COOKIE.refreshed, '1', { ...cookieBase, maxAge: 20 }); // evita ciclos: 2 × 401 em 20 s ⇒ login
  return NextResponse.redirect(new URL(next, req.url));
}
