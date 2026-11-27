// E2E da conta (Chromium real): recuperação de palavra-passe e encomendas com pedido de reembolso. SANDBOX_MODE (mostra o link "do e-mail").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'; const API = process.env.API_URL ?? 'http://localhost:3001'; const SHOTS = process.env.SHOTS_DIR;
const email = `acc${Date.now()}@web.test`; const oldPw = 'correct horse battery'; const newPw = 'a brand new passphrase 2026';
let browser, ctx, page;
before(async () => {
  browser = await chromium.launch(); ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } }); page = await ctx.newPage();
  await page.goto(BASE + '/register'); await page.fill('input[name=display_name]', 'Conta E2E'); await page.fill('input[name=email]', email); await page.fill('input[name=password]', oldPw);
  await Promise.all([page.waitForURL(BASE + '/'), page.click('main button[type=submit]')]);
});
after(async () => { await browser?.close(); });
const logout = async () => { await page.click('button:has-text("Sair")'); await page.waitForSelector('header a:has-text("Entrar")'); };

test('sem encomendas: mensagem vazia; depois de comprar, a encomenda aparece com o livro e o estado', async () => {
  await page.goto(BASE + '/account/orders'); assert.match(await page.textContent('main'), /Ainda não fez compras/);
  await page.goto(BASE + '/'); await page.click('text=Cartas do Índico'); await Promise.all([page.waitForURL(/checkout/), page.click('button:has-text("Comprar")')]);
  await Promise.all([page.waitForURL(/library\?purchased/, { timeout: 25000 }), page.click('button:has-text("Simular")')]);
  await page.goto(BASE + '/account/orders'); await page.waitForSelector('[data-testid=order]');
  const t = await page.textContent('[data-testid=order]'); assert.match(t, /Cartas do Índico/); assert.match(t, /Concluída/); assert.match(t, /12,99/); assert.equal(await page.locator('[data-testid=order] a:has-text("Ler")').count(), 1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/60-encomendas.png`, fullPage: true });
});

test('pedido de reembolso pela UI: aparece como «Reembolso pedido», não pode ser repetido e chega à fila do administrador', async () => {
  await page.click('[data-testid=order] summary:has-text("Pedir reembolso")'); await page.fill('[data-testid=order] textarea[name=reason]', 'Comprei por engano');
  await Promise.all([page.waitForURL(/ok=/), page.click('[data-testid=order] button:has-text("Enviar pedido")')]);
  assert.match(await page.textContent('.alert.ok'), /Pedido de reembolso enviado/);
  assert.match(await page.textContent('[data-testid=order]'), /Reembolso pedido/); assert.equal(await page.locator('[data-testid=order] summary').count(), 0, 'sem segundo pedido');
  // o pedido existe na API (o que o administrador vê na fila): confirmado pela base de dados via API do próprio cliente
  const lg = await (await fetch(`${API}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: oldPw }) })).json();
  const orders = await (await fetch(`${API}/v1/orders`, { headers: { authorization: `Bearer ${lg.access_token}` } })).json(); assert.equal(orders[0].items[0].refund_status, 'REQUESTED');
});

test('recuperar palavra-passe: resposta igual para e-mails que não existem (não revela contas)', async () => {
  await logout(); await page.goto(BASE + '/forgot-password'); await page.fill('input[name=email]', `nao-existe${Date.now()}@web.test`); await page.click('main button[type=submit]');
  await page.waitForSelector('[data-testid=forgot-sent]'); assert.match(await page.textContent('[data-testid=forgot-sent]'), /Se existir uma conta/); assert.equal(await page.locator('[data-testid=sandbox-link]').count(), 0, 'sem conta não há link');
});

test('recuperar palavra-passe: link → nova palavra-passe → a antiga deixa de servir → a nova entra', async () => {
  await page.goto(BASE + '/login'); await Promise.all([page.waitForURL(/\/forgot-password/), page.click('a:has-text("Esqueceu a palavra-passe?")')]); await page.fill('input[name=email]', email); await page.click('main button[type=submit]');
  await page.waitForSelector('[data-testid=sandbox-link] a'); if (SHOTS) await page.screenshot({ path: `${SHOTS}/61-recuperar.png` });
  await page.click('[data-testid=sandbox-link] a'); await page.waitForSelector('input[name=confirm]');
  await page.fill('input[name=password]', newPw); await page.fill('input[name=confirm]', 'diferente diferente 1'); await page.click('main button[type=submit]'); await page.waitForSelector('.alert.err'); assert.match(await page.textContent('.alert.err'), /não coincidem/);
  await page.fill('input[name=password]', 'curta'); await page.fill('input[name=confirm]', 'curta'); // o browser exige 12+ caracteres (minLength)
  assert.equal(await page.$eval('input[name=password]', (e) => e.validity.tooShort || !e.checkValidity()), true);
  await page.fill('input[name=password]', newPw); await page.fill('input[name=confirm]', newPw); await Promise.all([page.waitForURL(/\/login\?reset=1/), page.click('main button[type=submit]')]);
  assert.match(await page.textContent('.alert.ok'), /Palavra-passe alterada/);
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', oldPw); await page.click('main button[type=submit]'); await page.waitForSelector('.alert.err'); assert.match(await page.textContent('.alert.err'), /incorretos/);
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', newPw); await Promise.all([page.waitForURL(BASE + '/'), page.click('main button[type=submit]')]);
  assert.match(await page.textContent('header'), /Conta E2E/);
});

test('o link de recuperação é de uso único e as sessões antigas foram terminadas', async () => {
  // 2.º contexto com sessão aberta; repor a palavra-passe noutro sítio termina-a
  const c2 = await browser.newContext(); const p2 = await c2.newPage();
  await p2.goto(BASE + '/login'); await p2.fill('input[name=email]', email); await p2.fill('input[name=password]', newPw); await Promise.all([p2.waitForURL(BASE + '/'), p2.click('main button[type=submit]')]);
  await page.goto(BASE + '/forgot-password'); await page.fill('input[name=email]', email); await page.click('main button[type=submit]');
  await page.waitForSelector('[data-testid=sandbox-link] a', { timeout: 10000 }).catch(async (e) => { throw new Error(`${e.message} | url=${page.url()} | texto=${(await page.textContent('main')).slice(0, 200)}`); });
  const href = await page.getAttribute('[data-testid=sandbox-link] a', 'href'); const third = 'third passphrase for the test 9';
  await page.goto(BASE + href); await page.fill('input[name=password]', third); await page.fill('input[name=confirm]', third); await Promise.all([page.waitForURL(/reset=1/), page.click('main button[type=submit]')]);
  await page.goto(BASE + href); await page.fill('input[name=password]', 'yet another passphrase 123'); await page.fill('input[name=confirm]', 'yet another passphrase 123'); await page.click('main button[type=submit]');
  await page.waitForURL(/forgot-password\?error=/); assert.match(await page.textContent('.alert.err'), /inválido, expirou ou já foi usado/);
  // a sessão do outro dispositivo foi revogada: o access token deixa de valer em ≤ 5 s (cache da verificação de sessão), não ao fim de 15 min
  let out = false; for (let i = 0; i < 15 && !out; i++) { await p2.goto(BASE + '/account/orders'); out = /\/login/.test(p2.url()); if (!out) await p2.waitForTimeout(1000); }
  assert.ok(out, 'a sessão antiga deveria ter sido terminada');
  await c2.close();
});
