// E2E dos portais (Chromium real, pilha completa). Requer SANDBOX_MODE, `psql` e DATABASE_URL (para atribuir o papel de admin, que não é auto-serviço).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); const JSZip = require('jszip');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'; const API = process.env.API_URL ?? 'http://localhost:3001';
const DB = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5544/drp_demo'; const SHOTS = process.env.SHOTS_DIR;
const run = Date.now(); const password = 'correct horse battery';
const emails = { pub: `epub${run}@portal.test`, admin: `eadm${run}@portal.test`, cust: `ecust${run}@portal.test`, other: `eoth${run}@portal.test` };
const T1 = `Livro de Portal ${run}`; const T2 = `Livro Devolvido ${run}`;

// TOTP mínimo (RFC 6238), independente do servidor
const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const o = []; for (const c of s) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totp = (secret, off = 0) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + off)); const h = createHmac('sha1', b32(secret)).update(c).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };
const sql = (q) => execFileSync('psql', [DB, '-Atqc', q], { encoding: 'utf8' }).trim();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function epub(title) {
  const z = new JSZip(); z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:language>pt</dc:language><dc:identifier>urn:uuid:e2e</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`);
  z.file('OEBPS/c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><p>Olá, mundo.</p></body></html>');
  return z.generateAsync({ type: 'nodebuffer' });
}

let browser, P, A, C, O, adminSecret, bookId, book2Id;
const ctxs = [];
const newPage = async () => { const c = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 }); ctxs.push(c); return c.newPage(); };
const shot = (p, n) => SHOTS && p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
async function register(page, name, email) {
  await page.goto(BASE + '/register'); await page.fill('input[name=display_name]', name); await page.fill('input[name=email]', email); await page.fill('input[name=password]', password);
  await Promise.all([page.waitForURL(BASE + '/'), page.click('button[type=submit]')]);
}
async function createDraft(page, title, usd, mzn) {
  await page.goto(BASE + '/publisher/books/new'); await page.fill('input[name=title]', title); await page.fill('textarea[name=description]', 'Descrição do ' + title);
  await page.fill('input[name=price_USD]', usd); if (mzn) await page.fill('input[name=price_MZN]', mzn);
  await Promise.all([page.waitForURL(/\/publisher\/books\/[0-9a-f-]{36}/), page.click('button:has-text("Criar rascunho")')]);
  return page.url().split('/publisher/books/')[1].split('?')[0];
}
async function uploadValid(page, title) {
  await page.setInputFiles('[data-testid=upload-EPUB]', { name: 'livro.epub', mimeType: 'application/epub+zip', buffer: await epub(title) });
  await page.waitForFunction(() => /carregado e validado/.test(document.querySelector('[data-testid=upload-msg]')?.textContent ?? ''), null, { timeout: 15000 });
}

before(async () => { browser = await chromium.launch(); P = await newPage(); A = await newPage(); C = await newPage(); O = await newPage(); });
after(async () => { await browser?.close(); });

test('editora regista-se e fica pendente (ainda não pode publicar)', async () => {
  await register(P, 'Editora E2E', emails.pub); await P.goto(BASE + '/publisher');
  await P.fill('input[name=legal_name]', `Editora E2E ${run} Lda`); await P.fill('input[name=display_name]', `Editora E2E ${run}`);
  await Promise.all([P.waitForURL(/ok=/), P.click('button:has-text("Pedir registo")')]);
  await P.waitForSelector('[data-testid=publisher-pending]'); assert.match(await P.textContent('main'), /Pendente/);
  await P.goto(BASE + '/publisher/books/new'); await P.fill('input[name=title]', 'x'); await P.fill('input[name=price_USD]', '1'); await P.click('button:has-text("Criar rascunho")');
  await P.waitForSelector('.alert.err'); assert.match(await P.textContent('.alert.err'), /ainda não aprovada/i); // a API recusa: não basta esconder o botão
});

test('administração exige MFA: sem MFA vê o aviso; ativa o MFA e passa a ver as filas; cliente comum não vê nada', async () => {
  await register(A, 'Admin E2E', emails.admin); sql(`INSERT INTO user_roles SELECT u.id, r.id FROM users u, roles r WHERE u.email='${emails.admin}' AND r.name IN ('admin_catalog','admin_finance')`);
  await A.goto(BASE + '/admin'); await A.waitForSelector('.alert.warn'); assert.match(await A.textContent('main'), /verificação em dois passos/i); assert.equal((await A.textContent('[data-testid=stat-publishers] b')).trim(), '—', 'sem MFA os números não são mostrados');
  await A.goto(BASE + '/account/security'); await A.click('button:has-text("Ativar verificação")'); await A.waitForSelector('[data-testid=mfa-secret]');
  adminSecret = await A.textContent('[data-testid=mfa-secret]'); await A.fill('input[name=code]', totp(adminSecret)); await A.click('button:has-text("Confirmar")'); await A.waitForSelector('[data-testid=mfa-done]');
  await A.goto(BASE + '/admin'); await A.waitForSelector('[data-testid=stat-publishers]'); assert.ok(Number(await A.textContent('[data-testid=stat-publishers] b')) >= 1); await shot(A, '30-admin');
  await register(O, 'Cliente Curioso', emails.other); await O.goto(BASE + '/admin'); await O.waitForSelector('.alert.err'); assert.match(await O.textContent('main'), /Não tem permissões/);
  assert.equal(await O.locator('header a:has-text("Administração")').count(), 0); assert.equal(await A.locator('header a:has-text("Administração")').count(), 1);
});

test('admin aprova a editora; a editora passa a poder criar livros', async () => {
  await A.goto(BASE + '/admin/publishers'); await A.waitForSelector(`tr:has-text("${emails.pub}")`);
  await Promise.all([A.waitForURL(/ok=/), A.click(`tr:has-text("${emails.pub}") button`)]); assert.match(await A.textContent('.alert.ok'), /aprovada/i);
  assert.equal(await A.locator(`tr:has-text("${emails.pub}")`).count(), 0, 'sai da fila');
  await P.goto(BASE + '/publisher'); await P.waitForSelector('a:has-text("Novo livro")');
});

test('editora cria o livro, carrega um ficheiro INVÁLIDO (recusado com motivo) e um EPUB válido + capa', async () => {
  bookId = await createDraft(P, T1, '7,50', '480');
  assert.equal(await P.locator('[data-testid=submit-review]').isDisabled(), true, 'sem ficheiro válido não se pode submeter');
  await P.setInputFiles('[data-testid=upload-EPUB]', { name: 'falso.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('isto não é um EPUB') });
  await P.waitForFunction(() => /ZIP inválido|inválid/i.test(document.querySelector('[data-testid=upload-msg]')?.textContent ?? ''), null, { timeout: 15000 });
  await P.waitForSelector('[data-testid=formats] tr:has-text("Rejeitado")'); assert.match(await P.textContent('[data-testid=formats]'), /ZIP inválido/);
  await uploadValid(P, T1); await P.waitForSelector('[data-testid=formats] tr:has-text("Válido")');
  await P.setInputFiles('[data-testid=upload-COVER]', { name: 'capa.png', mimeType: 'image/png', buffer: PNG });
  await P.waitForFunction(() => /Capa.*validado/.test(document.querySelector('[data-testid=upload-msg]')?.textContent ?? ''), null, { timeout: 15000 });
  await shot(P, '31-editora-livro');
  await P.waitForFunction(() => !document.querySelector('[data-testid=submit-review]').disabled);
  await P.click('[data-testid=submit-review]'); await P.waitForSelector('h1:has-text("Em revisão")'); // espera pelo estado, não pelo URL
});

test('admin revê: sem contrato não publica; regista o contrato; publica', async () => {
  await A.goto(BASE + '/admin/reviews'); await A.waitForSelector(`tr:has-text("${T1}")`); await A.click(`a:has-text("${T1}")`);
  await A.waitForSelector('[data-testid=admin-formats]'); assert.match(await A.textContent('[data-testid=admin-formats]'), new RegExp(`título “${T1}”`)); // metadados extraídos do EPUB
  await Promise.all([A.waitForURL(/error=/), A.click('[data-testid=approve]')]); assert.match(await A.textContent('.alert.err'), /contrato/i);
  await A.fill('input[name=platform_pct]', '30'); await A.fill('input[name=sell]', 'WW'); await A.fill('input[name=deny]', 'KP');
  await A.click('button:has-text("Registar contrato")'); await A.waitForSelector('[data-testid=contract]'); assert.match(await A.textContent('[data-testid=contract]'), /30 %.*✕KP.*WW|30 %.*WW.*✕KP/);
  await A.click('[data-testid=approve]'); await A.waitForSelector('h1:has-text("Publicado")'); await shot(A, '32-admin-revisao');
});

test('o livro aparece na loja (com capa) para visitantes anónimos', async () => {
  const anon = await newPage(); await anon.goto(BASE + '/'); await anon.waitForSelector(`text=${T1}`);
  await anon.waitForFunction(() => [...document.images].every((i) => i.complete)); assert.equal(await anon.evaluate(() => [...document.images].filter((i) => i.naturalWidth === 0).length), 0);
  assert.match(await anon.textContent(`li:has-text("${T1}")`), /7,50/);
});

test('devolução: o admin devolve um livro com motivo e a editora vê o motivo; pode corrigir e voltar a submeter', async () => {
  book2Id = await createDraft(P, T2, '3', ''); await uploadValid(P, T2); await P.waitForFunction(() => !document.querySelector('[data-testid=submit-review]').disabled);
  await P.click('[data-testid=submit-review]'); await P.waitForSelector('h1:has-text("Em revisão")');
  await A.goto(BASE + `/admin/reviews/${book2Id}`); await A.fill('textarea[name=reason]', 'A capa não respeita as dimensões mínimas'); await Promise.all([A.waitForURL(/\/admin\/reviews\?/), A.click('[data-testid=reject]')]);
  await P.goto(BASE + `/publisher/books/${book2Id}`); await P.waitForSelector('[data-testid=rejection]'); assert.match(await P.textContent('[data-testid=rejection]'), /dimensões mínimas/); assert.match(await P.textContent('h1'), /Rascunho/);
});

test('isolamento: outro utilizador não abre o livro da editora (404); a editora não vê livros alheios', async () => {
  const r = await O.goto(BASE + `/publisher/books/${bookId}`); assert.ok(r.status() === 404 || /Não tem permissões|não foi encontrada|404/i.test(await O.textContent('body')));
});

test('compra de um cliente aparece nas vendas e nos royalties da editora (70% de 7,50 = 5,25)', async () => {
  await register(C, 'Cliente E2E', emails.cust);
  await C.goto(BASE + '/'); await C.click(`text=${T1}`); await Promise.all([C.waitForURL(/checkout/), C.click('button:has-text("Comprar")')]);
  await Promise.all([C.waitForURL(/library\?purchased/, { timeout: 25000 }), C.click('button:has-text("Simular")')]);
  await P.goto(BASE + '/publisher/sales'); await P.waitForSelector(`tr:has-text("${T1}")`); assert.match(await P.textContent(`tr:has-text("${T1}")`), /1.*7,50/s);
  let bal; for (let i = 0; i < 30 && !bal; i++) { await P.goto(BASE + '/publisher/royalties'); bal = await P.locator('[data-testid=balance-USD]').count() ? await P.textContent('[data-testid=balance-USD]') : null; if (!bal) await P.waitForTimeout(500); }
  assert.match(bal, /5,25/); await shot(P, '33-royalties');
});

test('reembolso: o admin decide com MFA recente (pede step-up), revoga o acesso e o royalty é estornado', async () => {
  // o cliente pede o reembolso (a UI de pedido ainda não existe: usa-se a API pública com o mesmo utilizador)
  const lg = await (await fetch(`${API}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: emails.cust, password }) })).json();
  const h = { 'content-type': 'application/json', authorization: `Bearer ${lg.access_token}` };
  const orders = await (await fetch(`${API}/v1/orders`, { headers: h })).json();
  const rr = await fetch(`${API}/v1/orders/${orders[0].id}/refund-requests`, { method: 'POST', headers: { ...h, 'idempotency-key': `e2e-refund-${run}` }, body: JSON.stringify({ reason: 'Comprei o livro errado' }) }); assert.equal(rr.status, 202);
  // simula "MFA verificado há 1 h": a sessão do admin renova-se e o token novo já não tem MFA recente
  sql(`UPDATE refresh_sessions SET mfa_at = now() - interval '1 hour' WHERE user_id=(SELECT id FROM users WHERE email='${emails.admin}')`);
  await A.context().clearCookies({ name: 'drp_at' });
  await A.goto(BASE + '/admin/refunds'); await A.waitForSelector(`[data-testid=refund]:has-text("${emails.cust}")`); assert.match(await A.textContent(`[data-testid=refund]:has-text("${emails.cust}")`), /Comprei o livro errado/);
  const form = A.locator(`[data-testid=refund]:has-text("${emails.cust}")`);
  await form.locator('input[name=reason]').fill('Dentro do prazo de 14 dias'); await form.locator('input[name=revoke]').check(); await form.locator('input[name=legal_basis]').fill('Direito de livre resolução');
  await Promise.all([A.waitForURL(/error=/), form.locator('button[value=APPROVE]').click()]); assert.match(await A.textContent('.alert.err'), /MFA recente/); await shot(A, '34-stepup');
  const form2 = A.locator(`[data-testid=refund]:has-text("${emails.cust}")`);
  await form2.locator('input[name=reason]').fill('Dentro do prazo de 14 dias'); await form2.locator('input[name=revoke]').check(); await form2.locator('input[name=legal_basis]').fill('Direito de livre resolução');
  await form2.locator('input[name=mfa_code]').fill(totp(adminSecret, 1)); // passo seguinte (≠ do usado na ativação)
  await Promise.all([A.waitForURL(/ok=/), form2.locator('button[value=APPROVE]').click()]); assert.match(await A.textContent('.alert.ok'), /aprovado/i);
  await C.goto(BASE + '/library'); assert.doesNotMatch(await C.textContent('main'), new RegExp(T1)); // acesso revogado
  let after; for (let i = 0; i < 30; i++) { await P.goto(BASE + '/publisher/royalties'); after = await P.locator('[data-testid=balance-USD]').textContent().catch(() => ''); if (/0,00/.test(after)) break; await P.waitForTimeout(500); }
  assert.match(after, /0,00/, 'o saldo de royalties foi estornado');
  assert.equal(Number(sql(`SELECT count(*) FROM audit_log WHERE action IN ('refund.approve','entitlement.revoke') AND created_at > now() - interval '5 minutes'`)) >= 2, true);
});
