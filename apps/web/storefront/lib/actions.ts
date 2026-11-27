'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api, ApiError } from './api';
import { SANDBOX } from './config';
import { safeNext } from './format';
import { clearTokens, deviceFingerprint, Tokens, writeTokens } from './session';
import { COOKIE, cookieBase } from './config';
import QRCode from 'qrcode';

const field = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const fail = (path: string, msg: string, extra = ''): never => redirect(`${path}?error=${encodeURIComponent(msg)}${extra}`);
const msg = (e: unknown) => (e instanceof ApiError ? (Array.isArray(e.body?.message) ? e.body.message.join('; ') : e.message) : 'Erro inesperado');

/** Devolve 'mfa' quando é preciso o 2.º factor (o desafio fica num cookie httpOnly de 5 min). */
async function login(email: string, password: string): Promise<'ok' | 'mfa'> {
  const jar = await cookies();
  const t = await api<Tokens & { mfa_challenge_id?: string }>('/auth/login', { body: { email, password, device: { fingerprint: deviceFingerprint(jar), platform: 'WEB', label: 'Browser' } }, token: null });
  if (t.mfa_challenge_id) { jar.set(COOKIE.mfa, t.mfa_challenge_id, { ...cookieBase, maxAge: 300 }); return 'mfa'; }
  writeTokens(jar, t); return 'ok';
}

export async function loginAction(form: FormData) {
  const next = safeNext(field(form, 'next')); let r: 'ok' | 'mfa';
  try { r = await login(field(form, 'email'), String(form.get('password') ?? '')); }
  catch (e) { return fail('/login', e instanceof ApiError && e.status === 401 ? 'E-mail ou palavra-passe incorretos, ou e-mail por verificar.' : e instanceof ApiError && e.status === 429 ? 'Demasiadas tentativas. Aguarde alguns minutos e tente de novo.' : msg(e), `&next=${encodeURIComponent(next)}`); }
  redirect(r === 'mfa' ? `/login/mfa?next=${encodeURIComponent(next)}` : next);
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
      if (token) { await api('/auth/verify-email', { token: null, body: { token } }); await login(email, password); } // conta nova: nunca tem MFA
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
  const paymentId = field(form, 'payment_id'); const orderId = field(form, 'order_id');
  try { await api(`/dev/fake-pay/${paymentId}`, { method: 'POST' }); } catch (e) { return fail('/library', msg(e)); }
  // Volta ao checkout: aí espera-se (de forma assíncrona) que o direito de leitura seja atribuído e só então se vai para a biblioteca.
  redirect(`/checkout/${orderId}`);
}

/** 2.º passo do login: valida o código TOTP (ou de recuperação) contra o desafio guardado no cookie. */
export async function mfaVerifyAction(form: FormData) {
  const jar = await cookies(); const next = safeNext(field(form, 'next')); const challenge = jar.get(COOKIE.mfa)?.value;
  if (!challenge) return fail('/login', 'A verificação expirou. Entre de novo.', `&next=${encodeURIComponent(next)}`);
  try {
    const t = await api<Tokens>('/auth/mfa/verify', { token: null, body: { challenge_id: challenge, code: field(form, 'code') } });
    jar.delete(COOKIE.mfa); writeTokens(jar, t);
  } catch (e) {
    if (e instanceof Error && (e as any).digest?.startsWith?.('NEXT_REDIRECT')) throw e;
    console.error('[mfaVerify]', e instanceof ApiError ? `API ${e.status}: ${e.message}` : e);
    if (e instanceof ApiError && e.status === 429) return fail('/login/mfa', 'Demasiadas tentativas. Aguarde alguns minutos.', `&next=${encodeURIComponent(next)}`);
    if (e instanceof ApiError && e.status === 401 && /expirado|inválido/i.test(String(e.message)) && !/Código/.test(String(e.message))) return fail('/login', 'A verificação expirou. Entre de novo.', `&next=${encodeURIComponent(next)}`);
    return fail('/login/mfa', 'Código inválido.', `&next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export interface EnrollState { error?: string; secret?: string; qr?: string; recovery_codes?: string[]; done?: boolean }

/** Inicia a inscrição: gera o segredo (cifrado no servidor) e devolve QR + segredo para mostrar UMA vez. */
export async function mfaEnrollAction(): Promise<EnrollState> {
  try {
    const r = await api<{ secret: string; otpauth_uri: string }>('/auth/mfa/enroll', { method: 'POST' });
    return { secret: r.secret, qr: await QRCode.toDataURL(r.otpauth_uri, { margin: 1, width: 220 }) };
  } catch (e) { return { error: e instanceof ApiError && e.status === 409 ? 'O MFA já está ativo.' : msg(e) }; }
}

/** Confirma com um código da app; o servidor devolve um access token já com MFA verificado e os códigos de recuperação. */
export async function mfaConfirmAction(prev: EnrollState, form: FormData): Promise<EnrollState> {
  try {
    const r = await api<{ recovery_codes: string[]; access_token: string; expires_in: number }>('/auth/mfa/confirm', { body: { code: field(form, 'code') } });
    const jar = await cookies(); jar.set(COOKIE.access, r.access_token, { ...cookieBase, maxAge: r.expires_in });
    return { done: true, recovery_codes: r.recovery_codes };
  } catch (e) { return { ...prev, error: e instanceof ApiError && e.status === 401 ? 'Código inválido. Verifique a hora do telemóvel e tente de novo.' : msg(e) }; }
}

export async function mfaDisableAction(form: FormData) {
  try { await api('/auth/mfa/disable', { body: { code: field(form, 'code') } }); }
  catch (e) { return fail('/account/security', e instanceof ApiError && e.status === 403 ? 'Os administradores não podem desativar o MFA.' : e instanceof ApiError && e.status === 429 ? 'Demasiadas tentativas.' : 'Código inválido.'); }
  redirect('/account/security?disabled=1');
}

/** Pede o link de recuperação. A resposta é sempre a mesma (não revela se o e-mail existe). Em sandbox mostra o link "do e-mail". */
export async function forgotPasswordAction(form: FormData) {
  const email = field(form, 'email'); let link = ''; const since = new Date(Date.now() - 200).toISOString();
  try {
    await api('/auth/forgot-password', { token: null, body: { email } });
    if (SANDBOX) { // sem transporte de e-mail real: expõe o link da notificação (só em sandbox, e só se a conta existir)
      for (let i = 0; i < 12 && !link; i++) {
        const t = await api<{ token: string }>(`/dev/reset-token?email=${encodeURIComponent(email)}&since=${encodeURIComponent(since)}`, { token: null }).then((r) => r.token, () => undefined);
        if (t) link = `/reset-password?token=${encodeURIComponent(t)}`; else await new Promise((r) => setTimeout(r, 300));
      }
    }
  } catch (e) { if (e instanceof ApiError && e.status === 429) return fail('/forgot-password', 'Demasiados pedidos. Tente de novo mais tarde.'); return fail('/forgot-password', msg(e)); }
  redirect(`/forgot-password?sent=1${link ? `&sandbox_link=${encodeURIComponent(link)}` : ''}`);
}

export async function resetPasswordAction(form: FormData) {
  const token = field(form, 'token'); const pw = String(form.get('password') ?? ''); const back2 = (m: string) => fail('/reset-password', m, `&token=${encodeURIComponent(token)}`);
  if (pw !== String(form.get('confirm') ?? '')) return back2('As palavras-passe não coincidem.');
  try { await api('/auth/reset-password', { token: null, body: { token, password: pw } }); }
  catch (e) { if (e instanceof ApiError && e.status === 400) return fail('/forgot-password', 'Este link é inválido, expirou ou já foi usado. Peça um novo.'); return back2(msg(e)); }
  const jar = await cookies(); clearTokens(jar); // todas as sessões foram revogadas no servidor
  redirect('/login?reset=1');
}
