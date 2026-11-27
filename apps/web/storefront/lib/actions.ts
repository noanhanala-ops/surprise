'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api, ApiError } from './api';
import { SANDBOX } from './config';
import { safeNext } from './format';
import { clearTokens, deviceFingerprint, Tokens, writeTokens } from './session';

const field = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const fail = (path: string, msg: string, extra = ''): never => redirect(`${path}?error=${encodeURIComponent(msg)}${extra}`);
const msg = (e: unknown) => (e instanceof ApiError ? (Array.isArray(e.body?.message) ? e.body.message.join('; ') : e.message) : 'Erro inesperado');

async function login(email: string, password: string) {
  const jar = await cookies();
  const t = await api<Tokens>('/auth/login', { body: { email, password, device: { fingerprint: deviceFingerprint(jar), platform: 'WEB', label: 'Browser' } }, token: null });
  writeTokens(jar, t);
}

export async function loginAction(form: FormData) {
  const next = safeNext(field(form, 'next'));
  try { await login(field(form, 'email'), String(form.get('password') ?? '')); }
  catch (e) { return fail('/login', e instanceof ApiError && e.status === 401 ? 'E-mail ou palavra-passe incorretos, ou e-mail por verificar.' : msg(e), `&next=${encodeURIComponent(next)}`); }
  redirect(next);
}

export async function registerAction(form: FormData) {
  const email = field(form, 'email'); const password = String(form.get('password') ?? '');
  try {
    await api('/auth/register', { token: null, body: { email, password, display_name: field(form, 'display_name'), country_code: field(form, 'country_code').toUpperCase() } });
    if (SANDBOX) { // sem transporte de e-mail real: "clica" no link da notificação gerada pelo outbox
      let token: string | undefined;
      for (let i = 0; i < 20 && !token; i++) {
        token = await api<{ token: string }>(`/dev/verification-token?email=${encodeURIComponent(email)}`, { token: null }).then((r) => r.token, () => undefined);
        if (!token) await new Promise((r) => setTimeout(r, 300));
      }
      if (token) { await api('/auth/verify-email', { token: null, body: { token } }); await login(email, password); }
    }
  } catch (e) { if (e instanceof ApiError && e.status === 409) return fail('/register', 'Este e-mail já está registado.'); return fail('/register', msg(e)); }
  redirect(SANDBOX ? '/' : '/login?registered=1');
}

export async function logoutAction() {
  const jar = await cookies();
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  clearTokens(jar); redirect('/');
}

/** Cria encomenda (snapshot de preço) e inicia o pagamento. A Idempotency-Key agrupa cliques repetidos na mesma janela de 10 min. */
export async function buyAction(form: FormData) {
  const editionId = field(form, 'edition_id'); const slug = field(form, 'slug'); const currency = field(form, 'currency') || 'USD';
  let orderId: string; let paymentId: string; let redirectUrl: string | undefined;
  try {
    const me = await api<{ country_code: string }>('/users/me');
    const bucket = Math.floor(Date.now() / 600_000);
    const order = await api<{ id: string }>('/orders', { idempotencyKey: `buy-${editionId}-${currency}-${bucket}`, body: { edition_ids: [editionId], currency, billing_country: me.country_code ?? 'MZ' } });
    const pay = await api<{ payment_id: string; redirect_url?: string }>('/payments/checkout', { idempotencyKey: `pay-${order.id}`, body: { order_id: order.id, method: SANDBOX ? 'fake' : String(form.get('method') ?? '') } });
    orderId = order.id; paymentId = pay.payment_id; redirectUrl = pay.redirect_url;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(`/login?next=${encodeURIComponent(`/books/${slug}`)}`);
    if (e instanceof ApiError && e.status === 409) redirect('/library');
    return fail(`/books/${slug}`, e instanceof ApiError && e.status === 451 ? 'Este livro não está disponível no seu país.' : msg(e));
  }
  if (!SANDBOX && redirectUrl) redirect(redirectUrl); // fornecedor real: checkout alojado por ele
  redirect(`/checkout/${orderId}?payment=${paymentId}`);
}

/** SANDBOX: aprova o pagamento simulado (assina e processa um webhook real). */
export async function sandboxPayAction(form: FormData) {
  if (!SANDBOX) redirect('/');
  const paymentId = field(form, 'payment_id');
  try { await api(`/dev/fake-pay/${paymentId}`, { method: 'POST' }); } catch (e) { return fail('/library', msg(e)); }
  redirect('/library?purchased=1');
}
