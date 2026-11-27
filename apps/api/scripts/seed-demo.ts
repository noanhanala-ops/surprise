/**
 * Seed de DEMONSTRAÇÃO: publica livros de ponta a ponta pela API pública (editora → upload → submissão → contrato → aprovação do admin).
 * Uso:  DATABASE_URL=… API_URL=http://localhost:3001 npx ts-node scripts/seed-demo.ts
 * Só para desenvolvimento/sandbox. Os EPUBs são gerados (texto de exemplo), não são livros reais.
 */
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { makePng, makeRichEpub } from '../fixtures/epub';

const API = (process.env.API_URL ?? 'http://localhost:3001') + '/v1';
const PASSWORD = 'demo-password-123';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); const j = t ? JSON.parse(t) : null; if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t}`); return j;
}

async function account(pool: Pool, email: string, name: string, roles: string[] = []) {
  await call('POST', '/auth/register', undefined, { email, password: PASSWORD, display_name: name, country_code: 'MZ' }).catch((e) => { if (!String(e).includes('409')) throw e; });
  for (let i = 0; i < 40; i++) { // o e-mail de verificação sai do outbox → notificação (sandbox)
    const r = await fetch(`${API}/dev/verification-token?email=${encodeURIComponent(email)}`);
    if (r.ok) { await call('POST', '/auth/verify-email', undefined, { token: ((await r.json()) as { token: string }).token }); break; }
    if (i === 39) { const ok = (await pool.query(`SELECT 1 FROM users WHERE email=$1 AND email_verified_at IS NOT NULL`, [email])).rowCount; if (!ok) throw new Error('verificação de e-mail não disponível (SANDBOX_MODE=true na API?)'); }
    await new Promise((r2) => setTimeout(r2, 250));
  }
  for (const role of roles) await pool.query(`INSERT INTO user_roles SELECT u.id, r.id FROM users u, roles r WHERE u.email=$1 AND r.name=$2 ON CONFLICT DO NOTHING`, [email, role]);
  return (await call('POST', '/auth/login', undefined, { email, password: PASSWORD })).access_token as string;
}

async function upload(token: string, editionId: string, kind: string, mime: string, buf: Buffer) {
  const i = await call('POST', `/publisher/books/${editionId}/assets`, token, { kind, mime_type: mime, size_bytes: buf.length, checksum_sha256: sha(buf) });
  if (i.mode === 'direct') { const r = await fetch(i.url, { method: 'PUT', headers: i.headers, body: buf }); if (!r.ok) throw new Error(`PUT bucket ${r.status}`); await call('POST', '/uploads/complete', token, { upload_token: i.upload_token }); }
  else { const r = await fetch(i.url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buf }); if (!r.ok) throw new Error(`PUT ${r.status} ${await r.text()}`); }
}

const BOOKS = [
  { title: 'A Varanda do Frangipani (exemplo)', usd: 899, mzn: 57000, top: [138, 59, 46], bottom: [59, 29, 23], desc: 'Livro de demonstração gerado automaticamente.\nUm romance fictício para testar compra, biblioteca e leitor.' },
  { title: 'Cartas do Índico (exemplo)', usd: 1299, mzn: 83000, top: [30, 90, 120], bottom: [10, 30, 50], desc: 'Livro de demonstração. Correspondência fictícia entre dois portos.' },
  { title: 'Guia de Leitura Lenta (exemplo)', usd: 499, mzn: 32000, top: [60, 110, 70], bottom: [20, 50, 30], desc: 'Livro de demonstração sobre ler sem pressa.' },
] as const;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const admin = await account(pool, 'admin@demo.test', 'Administração', ['admin_catalog', 'admin_finance']);
  const pub = await account(pool, 'editora@demo.test', 'Editora Demo');
  await account(pool, 'leitor@demo.test', 'Leitor Demo');
  const mine = await call('GET', '/publisher/books', pub).catch(() => []);
  let publisherId: string | undefined = (await pool.query(`SELECT pu.publisher_id FROM publisher_users pu JOIN users u ON u.id=pu.user_id WHERE u.email='editora@demo.test'`)).rows[0]?.publisher_id;
  if (!publisherId) { publisherId = (await call('POST', '/publisher/register', pub, { legal_name: 'Editora Demo, Lda', display_name: 'Editora Demo', country_code: 'MZ' })).id; }
  await call('POST', `/admin/publishers/${publisherId}/approve`, admin).catch(() => undefined); // já aprovada ⇒ ignora
  const have = new Set((mine as any[]).map((b) => b.title));
  for (const b of BOOKS) {
    if (have.has(b.title)) { console.log(`= já existe: ${b.title}`); continue; }
    const ed = await call('POST', '/publisher/books', pub, { publisher_id: publisherId, title: b.title, description: b.desc, language_code: 'pt', prices: [{ currency: 'USD', amount_minor: b.usd }, { currency: 'MZN', amount_minor: b.mzn }] });
    await upload(pub, ed.edition_id, 'EPUB', 'application/epub+zip', await makeRichEpub(b.title));
    await upload(pub, ed.edition_id, 'COVER', 'image/png', makePng(240, 360, b.top as any, b.bottom as any));
    await call('POST', `/publisher/books/${ed.edition_id}/submit`, pub);
    await call('POST', '/admin/contracts', admin, { edition_id: ed.edition_id, commission_bps: 3000, start_at: new Date(Date.now() - 86_400_000).toISOString(), territories: [{ country_code: 'WW', permission_type: 'SELL' }] });
    await call('POST', `/admin/books/${ed.edition_id}/approve`, admin);
    console.log(`+ publicado: ${b.title}`);
  }
  await pool.end();
  console.log(`\nContas de demonstração (palavra-passe ${PASSWORD}): admin@demo.test · editora@demo.test · leitor@demo.test`);
}
main().catch((e) => { console.error(e); process.exit(1); });
