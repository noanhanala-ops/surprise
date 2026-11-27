// E2E do leitor (Chromium real): comprar → ler com Readium → progresso, índice, marcadores, preferências e 2 dispositivos.
// Requer API (3001, SANDBOX_MODE=true) e web (3000) com os dados de `npm run seed:demo`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR;
const email = `rd${Date.now()}@web.test`; const password = 'correct horse battery';
let browser, ctxA, A, ctxB, B, editionId;

const READY = '[data-testid=reader][data-state=ready]';
const pct = async (p) => parseInt((await p.textContent('[data-testid=pct]')) ?? '0', 10);
const bffGet = (p, path) => p.evaluate(async (x) => { const r = await fetch(`/api/bff/${x}`); return { status: r.status, body: r.ok ? await r.json() : null }; }, path);
const until = async (fn, ms = 10000, step = 150) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise((r) => setTimeout(r, step)); } throw new Error('condição não cumprida: ' + JSON.stringify(last)); };
const open = async (p) => { await p.goto(`${BASE}/read/${editionId}`); await p.waitForSelector(READY, { timeout: 20000 }); await p.waitForTimeout(400); };
// O navigator mantém um *pool* de iframes (anterior/actual/seguinte): só a visível conta.
const frameText = async (p) => {
  for (const f of p.frames().filter((x) => x !== p.mainFrame())) {
    const visible = await f.frameElement().then((e) => e.evaluate((n) => getComputedStyle(n).visibility === 'visible')).catch(() => false);
    if (visible) return f.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  }
  return '';
};

before(async () => {
  browser = await chromium.launch();
  ctxA = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 }); A = await ctxA.newPage();
  await A.goto(BASE + '/register');
  await A.fill('input[name=display_name]', 'Leitor Reader'); await A.fill('input[name=email]', email); await A.fill('input[name=password]', password);
  await Promise.all([A.waitForURL(BASE + '/'), A.click('button[type=submit]')]);
  await A.click('text=Guia de Leitura Lenta'); await Promise.all([A.waitForURL(/checkout/), A.click('button:has-text("Comprar")')]);
  await Promise.all([A.waitForURL(/library\?purchased/), A.click('button:has-text("Simular")')]);
  editionId = (await A.getAttribute('ul.grid a.card', 'href')).split('/').pop();
});
after(async () => { await browser?.close(); });

test('abre o EPUB no Readium: conteúdo do livro dentro de um iframe, 0% no início', async () => {
  await open(A);
  assert.equal(await A.locator('[data-testid=reader-container] iframe').count(), 1);
  assert.match(await frameText(A), /Lorem ipsum/); assert.equal(await pct(A), 0);
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/11-leitor-inicio.png` });
});

test('avançar grava o progresso no servidor (versão 1) e ao reabrir retoma exactamente aí', async () => {
  for (let i = 0; i < 4; i++) { await A.click('button[aria-label="Página seguinte"]'); await A.waitForTimeout(250); }
  const before = await until(async () => { const p = await pct(A); return p > 0 ? p : 0; });
  const saved = await until(async () => { const r = await bffGet(A, `reading/${editionId}/progress`); return r.status === 200 && r.body.progress_percent > 0 ? r.body : null; });
  assert.equal(saved.version, 1); assert.ok(Math.abs(saved.progress_percent - before) <= 1, `servidor ${saved.progress_percent} vs ecrã ${before}`);
  await open(A); assert.ok(Math.abs((await pct(A)) - before) <= 1, 'deve retomar na posição guardada');
});

test('índice: navega para um capítulo e o progresso avança', async () => {
  await A.click('button[aria-label="Índice"]'); await A.waitForSelector('.rd-panel li');
  const items = await A.locator('.rd-panel li button').allTextContents(); assert.deepEqual(items, ['Capítulo Um', 'Capítulo Dois', 'Secção 2.1', 'Capítulo Três']);
  assert.ok(items.some((t) => t.includes('Capítulo Três')), 'TOC deve listar o Capítulo Três: ' + items.join('|'));
  await A.click('.rd-panel button:has-text("Capítulo Três")');
  await until(async () => /Fim\./.test(await frameText(A)), 8000); assert.ok((await pct(A)) > 50);
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/12-leitor-capitulo.png` });
});

test('marcadores: criar, listar, navegar e apagar (persistem no servidor)', async () => {
  await A.click('button[aria-label="Adicionar marcador"]'); await A.waitForSelector('button:has-text("Marcadores (1)")');
  assert.equal((await bffGet(A, `reading/${editionId}/annotations`)).body.bookmarks.length, 1);
  await A.click('button[aria-label="Índice"]'); await A.click('.rd-panel button:has-text("Capítulo Um")'); await until(async () => !/Fim\./.test(await frameText(A)));
  await A.click('button[aria-label="Marcadores"]'); await A.click('.rd-panel li button >> nth=0');
  await until(async () => /Fim\./.test(await frameText(A)), 8000);
  await A.click('button[aria-label="Marcadores"]'); await A.click('button[aria-label="Apagar marcador"]'); await A.waitForSelector('button:has-text("Marcadores (0)")');
  assert.equal((await bffGet(A, `reading/${editionId}/annotations`)).body.bookmarks.length, 0);
});

test('preferências: tema e tamanho aplicam-se, persistem na conta e voltam ao reabrir', async () => {
  await A.click('button[aria-label="Tema DARK"]'); await A.click('button[aria-label="Aumentar letra"]');
  assert.equal(await A.$eval('[data-testid=reader]', (e) => getComputedStyle(e).backgroundColor), 'rgb(18, 18, 18)');
  const prefs = await until(async () => { const r = await bffGet(A, 'reading/preferences'); return r.body?.theme === 'DARK' && r.body.font_size === 18 ? r.body : null; });
  assert.equal(prefs.theme, 'DARK');
  await open(A); assert.equal(await A.$eval('[data-testid=reader]', (e) => getComputedStyle(e).backgroundColor), 'rgb(18, 18, 18)');
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/13-leitor-escuro.png` });
  await A.click('button[aria-label="Tema LIGHT"]');
});

test('DOIS DISPOSITIVOS: o segundo avança; o primeiro é avisado e NÃO sobrescreve em silêncio', async () => {
  await open(A); await A.waitForTimeout(2500); // A estabiliza (reflow por causa do tamanho de letra) e grava, se for caso disso
  const a0 = await pct(A);
  const v0 = (await bffGet(A, `reading/${editionId}/progress`)).body.version;
  // Dispositivo B (outro browser, mesma conta)
  ctxB = await browser.newContext({ viewport: { width: 1100, height: 800 } }); B = await ctxB.newPage();
  await B.goto(BASE + '/login'); await B.fill('input[name=email]', email); await B.fill('input[name=password]', password);
  await Promise.all([B.waitForURL(BASE + '/'), B.click('button[type=submit]')]);
  await open(B); assert.ok(Math.abs((await pct(B)) - a0) <= 1, 'B retoma onde A ficou');
  await B.waitForTimeout(2500); // mais que o debounce de gravação (1,2 s)
  assert.equal((await bffGet(B, `reading/${editionId}/progress`)).body.version, v0, 'abrir o livro noutro dispositivo não grava nada (sem conflitos falsos)');
  await B.click('button[aria-label="Índice"]'); await B.click('.rd-panel button:has-text("Capítulo Três")');
  const remotePct = await until(async () => { const p = await pct(B); return p > a0 + 20 ? p : 0; });
  const atB = await until(async () => { const r = (await bffGet(B, `reading/${editionId}/progress`)).body; return r.version > v0 && r.progress_percent > a0 + 20 ? r : null; });
  // A (ainda no sítio antigo) vira a página → tenta gravar com a versão antiga → 409
  await A.click('button[aria-label="Página seguinte"]');
  await A.waitForSelector('.rd-banner', { timeout: 10000 });
  assert.match(await A.textContent('.rd-banner'), new RegExp(`${Math.round(atB.progress_percent)}%`));
  const server = (await bffGet(A, `reading/${editionId}/progress`)).body;
  assert.equal(server.version, atB.version, 'a escrita antiga foi rejeitada'); assert.equal(server.progress_percent, atB.progress_percent, 'o progresso do outro dispositivo não foi sobrescrito');
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/14-conflito.png` });
  await A.click('.rd-banner button:has-text("Ir para lá")');
  await until(async () => /Fim\./.test(await frameText(A)), 8000).catch(async (e) => { // diagnóstico em caso de falha
    const rows = []; for (const f of A.frames().filter((x) => x !== A.mainFrame())) rows.push([await f.frameElement().then((el) => el.evaluate((n) => getComputedStyle(n).visibility)).catch(() => '?'), (await f.evaluate(() => document.body?.innerText ?? '').catch(() => '?')).slice(0, 25)]);
    throw new Error(`${e.message} | pct=${await pct(A)} remote=${JSON.stringify(atB.locator).slice(0, 120)} frames=${JSON.stringify(rows)}`);
  });
  assert.equal(await A.locator('.rd-banner').count(), 0);
  assert.ok(remotePct > 50); await ctxB.close();
});

test('sem sessão ou sem direito o leitor não abre', async () => {
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(`${BASE}/read/${editionId}`); assert.match(anon.url(), /\/login\?next=/);
  assert.equal((await anon.request.get(`${BASE}/v1/read/token-invalido/manifest.json`)).status(), 403);
});

test('DESTAQUES E NOTAS: seleccionar → destacar; nota no painel; persiste ao reabrir; mudar cor; nota pela barra; apagar', async () => {
  const hlApi = async () => (await bffGet(A, `reading/${editionId}/annotations`)).body;
  const goChapter1 = async () => { await A.click('button[aria-label="Índice"]'); await A.click('.rd-panel button:has-text("Capítulo Um")'); await until(async () => /Lorem/.test(await frameText(A)), 8000); await A.waitForTimeout(500); };
  const visibleFrame = async (p) => { for (const f of p.frames().filter((x) => x !== p.mainFrame())) { if (await f.frameElement().then((e) => e.evaluate((n) => getComputedStyle(n).visibility === 'visible')).catch(() => false)) return f; } };
  const decorations = async () => (await visibleFrame(A)).evaluate(() => window.CSS?.highlights?.size ?? 0);
  // Onde o Readium pintou o destaque (CSS Highlight API) — para provar que cai na palavra seleccionada e não na 1.ª ocorrência do texto.
  const decoRects = async () => (await visibleFrame(A)).evaluate(() => { const out = []; for (const [, h] of window.CSS.highlights) for (const r of h) { const b = r.getBoundingClientRect(); out.push({ top: b.top, left: b.left, text: r.toString(), startOffset: r.startOffset }); } return out; });
  const selRect = async () => (await visibleFrame(A)).evaluate(() => { const b = getSelection().getRangeAt(0).getBoundingClientRect(); return { top: b.top, left: b.left, text: getSelection().toString() }; });
  const selectWord = async (nth) => { await (await visibleFrame(A)).locator('p').nth(nth).dblclick(); await A.waitForSelector('[data-testid=selection-bar]'); return (await A.textContent('.rd-sel-text')).replace(/[“”]/g, '').trim(); };

  await open(A); await goChapter1();
  // dblclick no centro do parágrafo: a palavra escolhida está bem para lá da 1.ª ocorrência do mesmo texto
  const word = await selectWord(0); assert.ok(word.length > 2, 'palavra seleccionada: ' + word); const where = await selRect();
  await A.click('button[aria-label="Destacar a amarelo"]'); await A.waitForSelector('button:has-text("Notas (1)")');
  assert.equal(await A.locator('[data-testid=selection-bar]').count(), 0, 'a barra fecha depois de destacar');
  let ann = await hlApi(); assert.equal(ann.highlights.length, 1); const h = ann.highlights[0];
  assert.equal(h.locator.text.highlight, word); assert.equal(h.color, 'yellow'); assert.ok(h.locator.text.before.length > 0 && h.locator.text.after.length > 0, 'guarda o contexto para localizar a ocorrência certa');
  await until(async () => (await decorations()) >= 1); // desenhado no texto (CSS Highlight API do Readium)
  { const d = (await decoRects())[0]; assert.equal(d.text, word); assert.ok(Math.abs(d.top - where.top) < 3 && Math.abs(d.left - where.left) < 3, `o destaque tem de cair na palavra seleccionada (${JSON.stringify(d)} vs ${JSON.stringify(where)}), não na 1.ª ocorrência`); }
  assert.ok(h.locator.locations.domRange.start.charOffset >= 0 && h.locator.locations.domRange.start.cssSelector.startsWith('body'), 'guarda o domRange exacto');
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/15-destaque.png` });

  // nota no painel
  await A.click('button[aria-label="Destaques e notas"]'); await A.waitForSelector('[data-testid=highlight-item]');
  await A.fill('[data-testid=highlight-item] textarea', 'Esta é a minha nota'); await A.click('[data-testid=highlight-item] button:has-text("Guardar nota")');
  await until(async () => (await hlApi()).notes.some((n) => n.content === 'Esta é a minha nota' && !n.deleted_at));

  // persiste ao reabrir (lista + destaque redesenhado)
  await open(A); await A.waitForSelector('button:has-text("Notas (1)")'); await goChapter1(); await until(async () => (await decorations()) >= 1);
  { const d = (await decoRects())[0]; assert.equal(d.startOffset, h.locator.locations.domRange.start.charOffset, 'ao reabrir, o destaque volta à mesma posição exacta'); }
  await A.click('button[aria-label="Destaques e notas"]'); assert.equal(await A.inputValue('[data-testid=highlight-item] textarea'), 'Esta é a minha nota');

  // mudar cor
  await A.click('[data-testid=highlight-item] button[aria-label="Cor rosa"]'); await until(async () => (await hlApi()).highlights[0].color === 'pink');

  // 2.º destaque, com nota escrita directamente na barra
  await A.click('button[aria-label="Destaques e notas"]'); // fecha o painel
  await selectWord(2); await A.click('button[aria-label="Adicionar nota"]'); await A.fill('input[aria-label="Texto da nota"]', 'Nota rápida'); await A.click('button[aria-label="Guardar nota"]');
  await A.waitForSelector('button:has-text("Notas (2)")'); ann = await hlApi(); assert.equal(ann.highlights.length, 2); assert.ok(ann.notes.some((n) => n.content === 'Nota rápida'));

  // apagar o primeiro: some do painel, do servidor e do texto
  await A.click('button[aria-label="Destaques e notas"]'); await A.locator('[data-testid=highlight-item]').first().locator('button[aria-label="Apagar destaque"]').click();
  await A.waitForSelector('button:has-text("Notas (1)")'); ann = await hlApi(); assert.equal(ann.highlights.length, 1); assert.equal(ann.highlights[0].color, 'yellow');
  await until(async () => (await decorations()) === 1);
});
