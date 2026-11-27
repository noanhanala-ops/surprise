// E2E do MFA no browser real: ativar com QR/segredo, login em 2 passos, anti-replay, código de recuperação uso único, desativar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR;
const email = `mfa${Date.now()}@web.test`; const password = 'correct horse battery';

// TOTP mínimo (RFC 6238) — independente da implementação do servidor, de propósito.
const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out = []; for (const c of s) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret, stepOffset = 0) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + stepOffset)); const h = createHmac('sha1', b32(secret)).update(c).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };

let browser, ctx, page, secret, recovery;
const shot = (n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const login = async (pw = password) => { await page.goto(BASE + '/login'); await page.fill('input[name=email]', email); await page.fill('input[name=password]', pw); await page.click('button[type=submit]'); };
// Espera pelo estado (link "Entrar" no cabeçalho), não pelo URL: o logout pode começar já em "/".
// Submete um código que vai ser RECUSADO e espera até a página assentar (resposta do POST + formulário reposto);
// esperar só por '.alert.err' apanharia o aviso de uma tentativa anterior.
const submitBad = async (code) => {
  await page.fill('input[name=code]', code);
  await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && /\/login\/mfa/.test(r.url())), page.click('button[type=submit]')]);
  await page.waitForFunction(() => document.querySelector('input[name=code]')?.value === '' && document.querySelector('.alert.err'));
};
const logout = async () => { await page.click('button:has-text("Sair")'); await page.waitForSelector('header a:has-text("Entrar")'); };

before(async () => {
  browser = await chromium.launch(); ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } }); page = await ctx.newPage();
  await page.goto(BASE + '/register'); await page.fill('input[name=display_name]', 'Utilizador MFA'); await page.fill('input[name=email]', email); await page.fill('input[name=password]', password);
  await Promise.all([page.waitForURL(BASE + '/'), page.click('button[type=submit]')]);
});
after(async () => { await browser?.close(); });

test('ativar MFA: QR + segredo; código errado é recusado; código certo ativa e mostra 10 códigos de recuperação', async () => {
  await page.goto(BASE + '/account/security'); await page.click('button:has-text("Ativar verificação")');
  await page.waitForSelector('[data-testid=mfa-secret]'); secret = await page.textContent('[data-testid=mfa-secret]'); assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(await page.locator('img[alt^="QR code"]').count(), 1); await shot('20-mfa-setup');
  await page.fill('input[name=code]', '000000'); await page.click('button:has-text("Confirmar")'); await page.waitForSelector('.alert.err'); assert.match(await page.textContent('.alert.err'), /inválido/i);
  await page.fill('input[name=code]', totp(secret)); await page.click('button:has-text("Confirmar")'); await page.waitForSelector('[data-testid=mfa-done]');
  recovery = await page.locator('[data-testid=recovery-codes] li').allTextContents(); assert.equal(recovery.length, 10); assert.ok(recovery.every((c) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(c))); await shot('21-mfa-recovery');
  await page.reload(); assert.equal(await page.locator('[data-testid=mfa-on]').count(), 1);
  assert.equal(await page.locator('[data-testid=recovery-codes]').count(), 0, 'os códigos de recuperação não voltam a ser mostrados');
});

test('login passa a exigir o 2.º passo; sem o código não há sessão', async () => {
  await logout(); await login(); await page.waitForURL(/\/login\/mfa/); await shot('22-mfa-login');
  await page.goto(BASE + '/library'); assert.match(page.url(), /\/login/, 'só com a palavra-passe não há acesso');
  assert.ok(!(await ctx.cookies()).some((c) => c.name === 'drp_at' || c.name === 'drp_rt'));
});

test('código errado é recusado; o código usado na ativação NÃO pode ser reutilizado (anti-replay); o do passo seguinte entra', async () => {
  await login(); await page.waitForURL(/\/login\/mfa/);
  await submitBad('123456'); assert.match(await page.textContent('.alert.err'), /inválido/i);
  await submitBad(totp(secret)); // mesmo passo que a ativação: replay
  await page.fill('input[name=code]', totp(secret, 1)); await Promise.all([page.waitForURL(BASE + '/'), page.click('button[type=submit]')]);
  assert.match(await page.textContent('header'), /Utilizador MFA/);
});

test('código de recuperação: entra uma vez; a segunda vez é recusado', async () => {
  await logout(); await login(); await page.waitForURL(/\/login\/mfa/);
  await page.fill('input[name=code]', recovery[0]); await Promise.all([page.waitForURL(BASE + '/'), page.click('button[type=submit]')]);
  await logout(); await login(); await page.waitForURL(/\/login\/mfa/);
  await submitBad(recovery[0]); // a 2.ª vez, o mesmo código de recuperação já não serve
});

test('sessão MFA em cookies httpOnly e desativar exige um código válido', async () => {
  await page.fill('input[name=code]', recovery[1]); await Promise.all([page.waitForURL(BASE + '/'), page.click('button[type=submit]')]);
  assert.ok((await ctx.cookies()).filter((c) => ['drp_at', 'drp_rt'].includes(c.name)).every((c) => c.httpOnly));
  await page.goto(BASE + '/account/security'); await page.fill('input[name=code]', '000000'); await page.click('button:has-text("Desativar")'); await page.waitForSelector('.alert.err'); // 1.º aviso desta página
  await page.fill('input[name=code]', recovery[2]); await page.click('button:has-text("Desativar")'); await page.waitForSelector('.alert.ok');
  await logout(); await login(); await page.waitForURL(BASE + '/'); // volta a entrar directamente
});
