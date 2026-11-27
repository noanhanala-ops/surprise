// E2E no browser real (Chromium): loja → conta → compra sandbox → biblioteca. Requer API (3001) e web (3000) a correr com dados de demonstração.
// Uso: node --test tests/e2e/web-flow.test.mjs   (BASE_URL, SHOTS_DIR opcionais)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR;
const email = `e2e${Date.now()}@web.test`; const password = 'correct horse battery';
let browser, ctx, page;
const shot = (n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

before(async () => { browser = await chromium.launch(); ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, locale: 'pt-PT', deviceScaleFactor: 1 }); page = await ctx.newPage(); });
after(async () => { await browser?.close(); });

test('catálogo público mostra os livros com capas carregadas', async () => {
  await page.goto(BASE + '/'); await page.waitForSelector('ul.grid li');
  assert.ok((await page.locator('ul.grid li').count()) >= 3);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const broken = await page.evaluate(() => [...document.images].filter((i) => i.naturalWidth === 0).length);
  assert.equal(broken, 0, 'todas as capas devem carregar');
  assert.match(await page.textContent('body'), /A Varanda do Frangipani/); await shot('01-catalogo');
});

test('rotas protegidas redirecionam para o login e ?next externo é ignorado', async () => {
  await page.goto(BASE + '/library'); assert.match(page.url(), /\/login\?next=%2Flibrary/);
  await page.goto(BASE + '/login?next=//evil.example'); assert.equal(await page.inputValue('input[name=next]'), '/');
});

test('registo em sandbox cria conta verificada e inicia sessão', async () => {
  await page.goto(BASE + '/register');
  await page.fill('input[name=display_name]', 'Leitora E2E'); await page.fill('input[name=email]', email); await page.fill('input[name=password]', password);
  await Promise.all([page.waitForURL(BASE + '/'), page.click('button[type=submit]')]);
  assert.match(await page.textContent('header'), /Leitora E2E/); await shot('02-sessao');
});

test('a sessão está em cookies httpOnly (JavaScript não consegue ler os tokens)', async () => {
  const cookies = await ctx.cookies(); const at = cookies.find((c) => c.name === 'drp_at'); const rt = cookies.find((c) => c.name === 'drp_rt');
  assert.ok(at?.httpOnly && rt?.httpOnly && at.sameSite === 'Lax');
  assert.doesNotMatch(await page.evaluate(() => document.cookie), /drp_(at|rt)/);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })), '{}');
});

test('compra de um livro: detalhe → checkout sandbox → biblioteca', async () => {
  await page.goto(BASE + '/'); await page.click('text=Cartas do Índico');
  await page.waitForSelector('h1:has-text("Cartas do Índico")'); assert.match(await page.textContent('main'), /12,99/); await shot('03-detalhe');
  await Promise.all([page.waitForURL(/\/checkout\//), page.click('button:has-text("Comprar")')]);
  assert.match(await page.textContent('main'), /sandbox/i); await shot('04-checkout');
  await Promise.all([page.waitForURL(/\/library\?purchased=1/), page.click('button:has-text("Simular pagamento aprovado")')]);
  assert.match(await page.textContent('main'), /Compra concluída/); assert.match(await page.textContent('ul.grid'), /Cartas do Índico/); await shot('05-biblioteca');
});

test('livro comprado passa a mostrar "Ler agora" e não oferece nova compra', async () => {
  await page.goto(BASE + '/'); await page.click('text=Cartas do Índico');
  await page.waitForSelector('a:has-text("Ler agora")'); assert.equal(await page.locator('button:has-text("Comprar")').count(), 0);
});

test('terminar sessão e voltar a entrar', async () => {
  await page.click('button:has-text("Sair")'); await page.waitForURL(BASE + '/');
  await page.goto(BASE + '/library'); assert.match(page.url(), /\/login/);
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', 'palavra-errada-123');
  await page.click('button[type=submit]'); await page.waitForSelector('.alert.err'); assert.match(await page.textContent('.alert.err'), /incorretos/);
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', password); // o formulário é reposto após o erro
  await Promise.all([page.waitForURL(BASE + '/library'), page.click('button[type=submit]')]);
  assert.match(await page.textContent('ul.grid'), /Cartas do Índico/);
});

test('BFF: só caminhos permitidos e mutações exigem o cabeçalho anti-CSRF', async () => {
  const r = (path, init) => page.evaluate(async ([p, i]) => { const x = await fetch(p, i); return x.status; }, [path, init]);
  assert.equal(await r('/api/bff/orders', {}), 404);                      // fora da lista de permissões
  assert.equal(await r('/api/bff/reading/preferences', {}), 200);
  assert.equal(await r('/api/bff/reading/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"theme":"DARK"}' }), 403); // sem X-Requested-With
  assert.equal(await r('/api/bff/reading/preferences', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-requested-with': 'drp' }, body: '{"theme":"DARK"}' }), 200);
});
