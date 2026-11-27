import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { API_URL, COOKIE } from '@/lib/config';
import { clearTokens, writeTokens, Tokens } from '@/lib/session';

/**
 * BFF para o JavaScript do browser (sincronização do leitor). Lista de permissões fechada; o token fica no cookie httpOnly.
 * Mutations exigem `X-Requested-With: drp` (cabeçalho não-simples ⇒ um <form> de outro site não o consegue enviar).
 */
const ALLOWED: Array<[RegExp, string[]]> = [
  [/^reading\/preferences$/, ['GET', 'PUT']],
  [/^publisher\/books\/[0-9a-f-]{36}\/assets$/, ['POST']], // pedir URL de upload
  [/^uploads\/complete$/, ['POST']], // concluir upload directo ao bucket
  [/^reading\/[0-9a-f-]{36}\/(progress|annotations)$/, ['GET', 'PUT']],
  [/^reading\/[0-9a-f-]{36}\/(bookmarks|highlights|session)$/, ['POST']],
  [/^reading\/[0-9a-f-]{36}\/(bookmarks|highlights)\/[0-9a-f-]{36}$/, ['DELETE']],
];

async function call(path: string, req: NextRequest, body: string | undefined, token?: string) {
  return fetch(`${API_URL}/v1/${path}${req.nextUrl.search}`, { method: req.method, cache: 'no-store', body,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join('/');
  if (!ALLOWED.some(([re, m]) => re.test(path) && m.includes(req.method))) return NextResponse.json({ message: 'Não permitido' }, { status: 404 });
  if (req.method !== 'GET' && req.headers.get('x-requested-with') !== 'drp') return NextResponse.json({ message: 'Pedido inválido' }, { status: 403 });
  const jar = await cookies(); const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.text();
  let r = await call(path, req, body, jar.get(COOKIE.access)?.value);
  let refreshed: Tokens | null = null;
  if (r.status === 401 && jar.get(COOKIE.refresh)) {
    const rr = await fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: jar.get(COOKIE.refresh)!.value }), cache: 'no-store' });
    if (rr.ok) { refreshed = (await rr.json()) as Tokens; r = await call(path, req, body, refreshed.access_token); } else clearTokens(jar);
  }
  if (refreshed) writeTokens(jar, refreshed);
  const text = await r.text();
  return new NextResponse(text || null, { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
