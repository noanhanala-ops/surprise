'use server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { api, ApiError } from './api';
import { COOKIE, cookieBase } from './config';
import { toMinor } from './format';

const field = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (path: string, kind: 'error' | 'ok', msg: string): never => redirect(`${path}${path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(msg)}`);
const text = (e: unknown) => e instanceof ApiError ? (Array.isArray(e.body?.message) ? e.body.message.join('; ') : e.message) : 'Erro inesperado';
const isNext = (e: unknown) => (e as any)?.digest?.startsWith?.('NEXT_REDIRECT');
/** Executa uma chamada; erro ⇒ volta a `path` com a mensagem. STEP_UP_REQUIRED / MFA_REQUIRED têm mensagens próprias. */
async function run<T>(path: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (isNext(e)) throw e;
    if (e instanceof ApiError && e.body?.code === 'STEP_UP_REQUIRED') return back(path, 'error', 'Esta operação exige MFA recente: introduza o código da app autenticadora e submeta de novo.');
    if (e instanceof ApiError && e.body?.code === 'MFA_REQUIRED') return back(path, 'error', 'Ative o MFA na sua conta (Segurança) para usar a administração.');
    return back(path, 'error', text(e));
  }
}

function prices(f: FormData) {
  const out: { currency: string; amount_minor: number }[] = [];
  for (const c of ['USD', 'MZN', 'EUR']) { const v = field(f, `price_${c}`); if (!v) continue; const m = toMinor(v); if (m === null) throw new ApiError(422, { message: `Preço ${c} inválido (use 12,50)` }); out.push({ currency: c, amount_minor: m }); }
  return out;
}

// ---------------- Editora
export async function registerPublisherAction(form: FormData) {
  await run('/publisher', () => api('/publisher/register', { body: { legal_name: field(form, 'legal_name'), display_name: field(form, 'display_name'), country_code: field(form, 'country_code').toUpperCase(), is_individual_author: form.get('individual') === 'on' } }));
  back('/publisher', 'ok', 'Pedido enviado. A editora fica pendente até a administração a aprovar.');
}

export async function createBookAction(form: FormData) {
  const body = await run('/publisher/books/new', async () => ({ title: field(form, 'title'), description: field(form, 'description') || undefined, language_code: field(form, 'language_code'), isbn: field(form, 'isbn') || undefined, prices: prices(form) }));
  const r = await run('/publisher/books/new', () => api<{ edition_id: string }>('/publisher/books', { body }));
  redirect(`/publisher/books/${r.edition_id}?ok=${encodeURIComponent('Rascunho criado. Carregue o EPUB e a capa.')}`);
}

export async function updateBookAction(form: FormData) {
  const id = field(form, 'id'); const p = `/publisher/books/${id}`;
  const body = await run(p, async () => ({ title: field(form, 'title'), description: field(form, 'description') || undefined, language_code: field(form, 'language_code'), isbn: field(form, 'isbn') || undefined, prices: prices(form) }));
  await run(p, () => api(`/publisher/books/${id}`, { method: 'PUT', body }));
  back(p, 'ok', 'Alterações guardadas.');
}

export async function submitBookAction(form: FormData) {
  const id = field(form, 'id'); const p = `/publisher/books/${id}`;
  await run(p, () => api(`/publisher/books/${id}/submit`, { method: 'POST' }));
  back(p, 'ok', 'Submetido para revisão.');
}

// ---------------- Administração
export async function approvePublisherAction(form: FormData) {
  await run('/admin/publishers', () => api(`/admin/publishers/${field(form, 'id')}/approve`, { method: 'POST' }));
  back('/admin/publishers', 'ok', 'Editora aprovada.');
}

export async function createContractAction(form: FormData) {
  const id = field(form, 'id'); const p = `/admin/reviews/${id}`;
  const pct = Number(field(form, 'platform_pct').replace(',', '.')); if (!(pct >= 0 && pct <= 100)) back(p, 'error', 'Comissão da plataforma inválida (0–100 %).');
  const sell = field(form, 'sell').toUpperCase().split(/[\s,;]+/).filter(Boolean); const deny = field(form, 'deny').toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if (!sell.length) back(p, 'error', 'Indique pelo menos um território de venda (WW = mundo).');
  const territories = [...sell.map((c) => ({ country_code: c, permission_type: 'SELL' as const })), ...deny.map((c) => ({ country_code: c, permission_type: 'DENY' as const }))];
  await run(p, () => api('/admin/contracts', { body: { edition_id: id, commission_bps: Math.round(pct * 100), start_at: new Date(field(form, 'start_at') || Date.now()).toISOString(), territories } }));
  back(p, 'ok', 'Contrato criado.');
}

export async function approveBookAction(form: FormData) {
  const id = field(form, 'id'); await run(`/admin/reviews/${id}`, () => api(`/admin/books/${id}/approve`, { method: 'POST' }));
  back(`/admin/reviews/${id}`, 'ok', 'Edição publicada.');
}
export async function rejectBookAction(form: FormData) {
  const id = field(form, 'id'); await run(`/admin/reviews/${id}`, () => api(`/admin/books/${id}/reject`, { body: { reason: field(form, 'reason') } }));
  back('/admin/reviews', 'ok', 'Edição devolvida à editora com o motivo indicado.');
}
export async function suspendBookAction(form: FormData) {
  const id = field(form, 'id'); await run(`/admin/reviews/${id}`, () => api(`/admin/books/${id}/suspend`, { body: { reason: field(form, 'reason') } }));
  back(`/admin/reviews/${id}`, 'ok', 'Edição suspensa (quem já a comprou mantém o acesso).');
}

/** Decisão de reembolso. Se o administrador indicar um código MFA, faz step-up primeiro (renova o "MFA recente" e o token). */
export async function decideRefundAction(form: FormData) {
  const p = '/admin/refunds'; const id = field(form, 'id'); const mfa = field(form, 'mfa_code');
  if (mfa) {
    const r = await run(p, () => api<{ access_token: string; expires_in: number }>('/auth/mfa/step-up', { body: { code: mfa } }));
    (await cookies()).set(COOKIE.access, r.access_token, { ...cookieBase, maxAge: r.expires_in });
  }
  const revoke = form.get('revoke') === 'on';
  await run(p, () => api(`/admin/refunds/${id}/decision`, { body: { decision: field(form, 'decision'), reason: field(form, 'reason'), revoke_entitlement: revoke, legal_basis: revoke ? field(form, 'legal_basis') : undefined } }));
  back(p, 'ok', field(form, 'decision') === 'APPROVE' ? 'Reembolso aprovado e processado.' : 'Reembolso rejeitado.');
}
