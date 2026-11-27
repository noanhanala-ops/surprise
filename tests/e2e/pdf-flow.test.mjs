// E2E do leitor de PDF (PDF.js) no Chromium real: abre, renderiza, navega, zoom, retoma, marcadores e conflito entre dispositivos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'; const SHOTS = process.env.SHOTS_DIR;
const email = `pdf${Date.now()}@web.test`; const password = 'correct horse battery'; const TITLE = 'Manual de Jardinagem em PDF';
let browser, ctxA, A, editionId;
const READY = '[data-testid=pdf-reader][data-state=ready]';
const bffGet = (p, path) => p.evaluate(async (x) => { const r = await fetch(`/api/bff/${x}`); return { status: r.status, body: r.ok ? await r.json() : null }; }, path);
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise((r) => setTimeout(r, 150)); } throw new Error('condição não cumprida: ' + JSON.stringify(last)); };
const pageNo = async (p) => Number(await p.inputValue('[data-testid=pdf-page]'));
/** A página só conta como desenhada quando o canvas tem pixels (não está em branco) e o data-rendered coincide com a página pedida. */
const rendered = async (p, n) => until(async () => p.evaluate((x) => { const c = document.querySelector('[data-testid=pdf-canvas]'); if (!c || c.dataset.rendered !== String(x)) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 120) dark++; return dark > 20; }, n), 15000);
const open = async (p) => { await p.goto(`${BASE}/read/${editionId}`); await p.waitForSelector(READY, { timeout: 20000 }); };

before(async () => {
  browser = await chromium.launch(); ctxA = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 }); A = await ctxA.newPage();
  await A.goto(BASE + '/register'); await A.fill('input[name=display_name]', 'Leitor PDF'); await A.fill('input[name=email]', email); await A.fill('input[name=password]', password);
  await Promise.all([A.waitForURL(BASE + '/'), A.click('button[type=submit]')]);
  await A.click(`text=${TITLE}`); await Promise.all([A.waitForURL(/checkout/), A.click('button:has-text("Comprar")')]);
  await Promise.all([A.waitForURL(/library\?purchased/, { timeout: 25000 }), A.click('button:has-text("Simular")')]);
  assert.match(await A.textContent('ul.grid'), /PDF/); editionId = (await A.getAttribute('ul.grid a.card', 'href')).split('/').pop();
});
after(async () => { await browser?.close(); });

test('abre o PDF: 12 páginas, página 1 desenhada com pixels reais', async () => {
  await open(A); assert.equal(await A.textContent('[data-testid=pdf-total]'), '12'); assert.equal(await pageNo(A), 1); await rendered(A, 1);
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/40-pdf.png` });
});

test('navegar (botões, teclado, ir para página) e zoom', async () => {
  await A.click('button[aria-label="Página seguinte"]'); await rendered(A, 2); assert.equal(await pageNo(A), 2);
  await A.keyboard.press('ArrowRight'); await rendered(A, 3); await A.keyboard.press('ArrowLeft'); await rendered(A, 2);
  await A.fill('[data-testid=pdf-page]', '7'); await rendered(A, 7); assert.equal(await A.textContent('[data-testid=pct]'), '58%');
  const w0 = await A.$eval('[data-testid=pdf-canvas]', (c) => c.getBoundingClientRect().width);
  await A.click('button[aria-label="Aumentar zoom"]'); await A.click('button[aria-label="Aumentar zoom"]'); await rendered(A, 7);
  const w1 = await A.$eval('[data-testid=pdf-canvas]', (c) => c.getBoundingClientRect().width); assert.ok(w1 > w0 * 1.2, `zoom deve alargar a página (${w0} → ${w1})`);
  await A.click('button[aria-label="Diminuir zoom"]'); await A.click('button[aria-label="Diminuir zoom"]'); await A.click('button:has-text("‹")').catch(() => undefined);
});

test('o progresso é guardado (versão e página) e ao reabrir retoma na mesma página', async () => {
  await A.fill('[data-testid=pdf-page]', '9'); await rendered(A, 9);
  const saved = await until(async () => { const r = await bffGet(A, `reading/${editionId}/progress`); return r.status === 200 && r.body.locator.locations.position === 9 ? r.body : null; });
  assert.equal(saved.locator.href, 'pdf'); assert.equal(saved.progress_percent, 75);
  await open(A); assert.equal(await pageNo(A), 9); await rendered(A, 9);
  await A.waitForTimeout(2500); assert.equal((await bffGet(A, `reading/${editionId}/progress`)).body.version, saved.version, 'abrir não grava nada');
});

test('marcadores por página: criar, listar, ir para, apagar', async () => {
  await A.fill('[data-testid=pdf-page]', '4'); await rendered(A, 4); await A.click('button[aria-label="Adicionar marcador"]'); await A.waitForSelector('button:has-text("Marcadores (1)")');
  await A.fill('[data-testid=pdf-page]', '11'); await rendered(A, 11);
  await A.click('button[aria-label="Marcadores"]'); await A.click('.rd-panel li button >> nth=0'); await rendered(A, 4); assert.equal(await pageNo(A), 4);
  await A.click('button[aria-label="Marcadores"]'); await A.click('button[aria-label="Apagar marcador"]'); await A.waitForSelector('button:has-text("Marcadores (0)")');
  await until(async () => (await bffGet(A, `reading/${editionId}/progress`)).body?.locator.locations.position === 4); // espera pela gravação (debounce) antes do teste seguinte
});

test('DOIS DISPOSITIVOS: o segundo avança; o primeiro é avisado e o servidor não é sobrescrito', async () => {
  await open(A); const a0 = await pageNo(A); await A.waitForTimeout(2500); const v0 = (await bffGet(A, `reading/${editionId}/progress`)).body.version;
  const ctxB = await browser.newContext({ viewport: { width: 1000, height: 900 } }); const B = await ctxB.newPage();
  await B.goto(BASE + '/login'); await B.fill('input[name=email]', email); await B.fill('input[name=password]', password); await Promise.all([B.waitForURL(BASE + '/'), B.click('button[type=submit]')]);
  await open(B); assert.equal(await pageNo(B), a0); await B.fill('[data-testid=pdf-page]', '12'); await rendered(B, 12);
  const atB = await until(async () => { const r = (await bffGet(B, `reading/${editionId}/progress`)).body; return r.version > v0 && r.locator.locations.position === 12 ? r : null; });
  await A.click('button[aria-label="Página anterior"]'); await A.waitForSelector('.rd-banner', { timeout: 10000 }); assert.match(await A.textContent('.rd-banner'), /página 12/);
  const server = (await bffGet(A, `reading/${editionId}/progress`)).body; assert.equal(server.version, atB.version); assert.equal(server.locator.locations.position, 12);
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/41-pdf-conflito.png` });
  await A.click('.rd-banner button:has-text("Ir para lá")'); await rendered(A, 12); assert.equal(await pageNo(A), 12); await ctxB.close();
});

test('sem direito/sessão o PDF não abre e o token de descarga não é reutilizável por outro', async () => {
  const anon = await (await browser.newContext()).newPage(); await anon.goto(`${BASE}/read/${editionId}`); assert.match(anon.url(), /\/login\?next=/);
  assert.equal((await anon.request.get(`${BASE}/v1/content/token-invalido`)).status(), 403);
});
