/**
 * Seed de DEMONSTRAÇÃO: publica livros de ponta a ponta pela API pública (editora → upload → submissão → contrato → aprovação do admin).
 * Uso:  DATABASE_URL=… API_URL=http://localhost:3001 npx ts-node scripts/seed-demo.ts
 * Só para desenvolvimento/sandbox. Os EPUBs são gerados (texto de exemplo), não são livros reais.
 */
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { makePdf, makePng, makeRichEpub } from '../fixtures/epub';
import { base32Decode, totp } from '../src/identity/totp';

const API = (process.env.API_URL ?? 'http://localhost:3001') + '/v1';
const PASSWORD = 'demo-password-123';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); const j = t ? JSON.parse(t) : null; if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t}`); return j;
}

/** Cria (se preciso) e verifica a conta, atribui papéis e devolve um access token. Contas com MFA ativo precisam do segredo TOTP em `totpSecret`. */
async function account(pool: Pool, email: string, name: string, roles: string[] = [], totpSecret?: string) {
  await call('POST', '/auth/register', undefined, { email, password: PASSWORD, display_name: name, country_code: 'MZ' }).catch((e) => { if (!String(e).includes('409')) throw e; });
  for (let i = 0; i < 40; i++) { // o e-mail de verificação sai do outbox → notificação (sandbox)
    const r = await fetch(`${API}/dev/verification-token?email=${encodeURIComponent(email)}`);
    if (r.ok) { await call('POST', '/auth/verify-email', undefined, { token: ((await r.json()) as { token: string }).token }); break; }
    if (i === 39) { const ok = (await pool.query(`SELECT 1 FROM users WHERE email=$1 AND email_verified_at IS NOT NULL`, [email])).rowCount; if (!ok) throw new Error('verificação de e-mail não disponível (SANDBOX_MODE=true na API?)'); }
    await new Promise((r2) => setTimeout(r2, 250));
  }
  for (const role of roles) await pool.query(`INSERT INTO user_roles SELECT u.id, r.id FROM users u, roles r WHERE u.email=$1 AND r.name=$2 ON CONFLICT DO NOTHING`, [email, role]);
  const login = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
  if (login.mfa_challenge_id) { // a conta já tem MFA (execução anterior): precisa do segredo guardado
    if (!totpSecret) throw new Error(`${email} já tem MFA ativo: defina DEMO_ADMIN_TOTP com o segredo impresso na 1.ª execução (ou use uma base limpa).`);
    return (await call('POST', '/auth/mfa/verify', undefined, { challenge_id: login.mfa_challenge_id, code: totp(base32Decode(totpSecret)) })).access_token as string;
  }
  if (!roles.some((r) => r.startsWith('admin_'))) return login.access_token as string;
  // Administradores têm de usar MFA: inscreve já (a confirmação devolve um token com MFA verificado).
  const enr = await call('POST', '/auth/mfa/enroll', login.access_token);
  const conf = await call('POST', '/auth/mfa/confirm', login.access_token, { code: totp(base32Decode(enr.secret)) });
  console.log(`\n!! MFA do administrador ativado. Segredo TOTP (guarde-o; para novas execuções: DEMO_ADMIN_TOTP=${enr.secret}):\n   ${enr.secret}\n   Códigos de recuperação: ${conf.recovery_codes.join(' ')}\n`);
  return conf.access_token as string;
}

async function upload(token: string, editionId: string, kind: string, mime: string, buf: Buffer) {
  const i = await call('POST', `/publisher/books/${editionId}/assets`, token, { kind, mime_type: mime, size_bytes: buf.length, checksum_sha256: sha(buf) });
  if (i.mode === 'direct') { const r = await fetch(i.url, { method: 'PUT', headers: i.headers, body: buf }); if (!r.ok) throw new Error(`PUT bucket ${r.status}`); await call('POST', '/uploads/complete', token, { upload_token: i.upload_token }); }
  else { const r = await fetch(i.url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buf }); if (!r.ok) throw new Error(`PUT ${r.status} ${await r.text()}`); }
}

const BOOKS: readonly { title: string; usd: number; mzn: number; top: readonly number[]; bottom: readonly number[]; desc: string; pdf?: boolean }[] = [
  { title: 'A Varanda do Frangipani (exemplo)', usd: 899, mzn: 57000, top: [138, 59, 46], bottom: [59, 29, 23], desc: 'Livro de demonstração gerado automaticamente.\nUm romance fictício para testar compra, biblioteca e leitor.' },
  { title: 'Cartas do Índico (exemplo)', usd: 1299, mzn: 83000, top: [30, 90, 120], bottom: [10, 30, 50], desc: 'Livro de demonstração. Correspondência fictícia entre dois portos.' },
  { title: 'Guia de Leitura Lenta (exemplo)', usd: 499, mzn: 32000, top: [60, 110, 70], bottom: [20, 50, 30], desc: 'Livro de demonstração sobre ler sem pressa.' },
  { title: 'Manual de Jardinagem em PDF (exemplo)', usd: 699, mzn: 44000, top: [120, 90, 30], bottom: [50, 35, 10], pdf: true, desc: 'Livro de demonstração em PDF (12 páginas) para testar o leitor de PDF.' },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const pub = await account(pool, 'editora@demo.test', 'Editora Demo');
  await account(pool, 'leitor@demo.test', 'Leitor Demo');
  const mine = await call('GET', '/publisher/books', pub).catch(() => []);
  let publisherId: string | undefined = (await pool.query(`SELECT pu.publisher_id FROM publisher_users pu JOIN users u ON u.id=pu.user_id WHERE u.email='editora@demo.test'`)).rows[0]?.publisher_id;
  if (!publisherId) { publisherId = (await call('POST', '/publisher/register', pub, { legal_name: 'Editora Demo, Lda', display_name: 'Editora Demo', country_code: 'MZ' })).id; }
  const todo = BOOKS.filter((b) => !new Set((mine as any[]).map((x) => x.title)).has(b.title));
  const approved = ((await call('GET', '/publisher/me', pub)) as any[])[0]?.status === 'ACTIVE';
  // O administrador (com MFA) só é preciso se houver algo para aprovar/publicar.
  let adminToken: string | undefined;
  const admin = async () => (adminToken ??= await account(pool, 'admin@demo.test', 'Administração', ['admin_catalog', 'admin_finance'], process.env.DEMO_ADMIN_TOTP));
  if (!approved) await call('POST', `/admin/publishers/${publisherId}/approve`, await admin());
  for (const b of BOOKS) {
    if (!todo.includes(b)) { console.log(`= já existe: ${b.title}`); continue; }
    const ed = await call('POST', '/publisher/books', pub, { publisher_id: publisherId, title: b.title, description: b.desc, language_code: 'pt', prices: [{ currency: 'USD', amount_minor: b.usd }, { currency: 'MZN', amount_minor: b.mzn }] });
    if (b.pdf) await upload(pub, ed.edition_id, 'PDF', 'application/pdf', await makePdf(b.title, 12));
    else await upload(pub, ed.edition_id, 'EPUB', 'application/epub+zip', await makeRichEpub(b.title));
    await upload(pub, ed.edition_id, 'COVER', 'image/png', makePng(240, 360, b.top as any, b.bottom as any));
    await call('POST', `/publisher/books/${ed.edition_id}/submit`, pub);
    const adm = await admin();
    await call('POST', '/admin/contracts', adm, { edition_id: ed.edition_id, commission_bps: 3000, start_at: new Date(Date.now() - 86_400_000).toISOString(), territories: [{ country_code: 'WW', permission_type: 'SELL' }] });
    await call('POST', `/admin/books/${ed.edition_id}/approve`, adm);
    console.log(`+ publicado: ${b.title}`);
  }
  await pool.end();
  console.log(`\nContas de demonstração (palavra-passe ${PASSWORD}): admin@demo.test (MFA) · editora@demo.test · leitor@demo.test`);
}
main().catch((e) => { console.error(e); process.exit(1); });
