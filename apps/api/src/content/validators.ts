import JSZip from 'jszip';

export type Kind = 'COVER' | 'PREVIEW' | 'EPUB' | 'PDF' | 'COMIC' | 'AUDIOBOOK' | 'SOURCE_FILE';
export interface ValidationResult { ok: boolean; reason?: string; metadata?: Record<string, unknown> }

const MAX_ENTRIES = 20000;
const MAX_UNCOMPRESSED = 2 * 1024 ** 3; // 2 GiB (protecção contra zip bombs)
const fail = (reason: string): ValidationResult => ({ ok: false, reason });

async function openZip(buf: Buffer): Promise<JSZip | string> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buf); } catch { return 'Ficheiro ZIP inválido'; }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ENTRIES) return 'Demasiadas entradas no arquivo';
  const total = entries.reduce((n, f) => n + ((f as any)._data?.uncompressedSize ?? 0), 0);
  if (total > MAX_UNCOMPRESSED) return 'Tamanho descomprimido excessivo';
  if (entries.some((f) => f.name.includes('..') || f.name.startsWith('/'))) return 'Caminhos inseguros no arquivo';
  return zip;
}

export async function validateEpub(buf: Buffer): Promise<ValidationResult> {
  const z = await openZip(buf); if (typeof z === 'string') return fail(z);
  const mt = await z.file('mimetype')?.async('string');
  if (mt?.trim() !== 'application/epub+zip') return fail('EPUB inválido: mimetype em falta ou incorrecto');
  const container = await z.file('META-INF/container.xml')?.async('string');
  const opfPath = container && /full-path="([^"]+)"/.exec(container)?.[1];
  if (!opfPath) return fail('EPUB inválido: container.xml sem rootfile');
  const opf = await z.file(opfPath)?.async('string');
  if (!opf) return fail('EPUB inválido: ficheiro OPF em falta');
  if (!/<spine[\s>]/.test(opf) || !/<manifest[\s>]/.test(opf)) return fail('EPUB inválido: OPF sem manifest/spine');
  const pick = (re: RegExp) => re.exec(opf)?.[1]?.trim();
  const title = pick(/<dc:title[^>]*>([^<]+)</);
  if (!title) return fail('EPUB inválido: sem dc:title');
  // Política: sem conteúdo activo. Os iframes do leitor partilham a origem da app (allow-same-origin), logo um <script> num EPUB seria XSS.
  const props = [...opf.matchAll(/properties="([^"]*)"/g)].map((m) => m[1]);
  if (props.some((p) => /\bscripted\b/.test(p))) return fail('EPUB com scripts (properties="scripted") não é permitido');
  for (const name of Object.keys(z.files)) {
    if (!/\.(x?html?|svg)$/i.test(name)) continue;
    const src = await z.file(name)!.async('string');
    if (/<script[\s>]/i.test(src) || /\son[a-z]+\s*=/i.test(src) || /javascript:/i.test(src)) return fail(`Conteúdo activo (scripts/handlers) em ${name} não é permitido`);
  }
  return { ok: true, metadata: { title, language: pick(/<dc:language[^>]*>([^<]+)</), identifier: pick(/<dc:identifier[^>]*>([^<]+)</), opf: opfPath, drm: z.file('META-INF/encryption.xml') ? 'encryption.xml presente' : 'none' } };
}

export function validatePdf(buf: Buffer): ValidationResult {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return fail('PDF inválido: cabeçalho em falta');
  if (!buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1').includes('%%EOF')) return fail('PDF inválido: truncado (sem %%EOF)');
  return { ok: true, metadata: { version: buf.subarray(5, 8).toString('latin1') } };
}

export async function validateComic(buf: Buffer): Promise<ValidationResult> {
  const z = await openZip(buf); if (typeof z === 'string') return fail(z);
  const pages = Object.keys(z.files).filter((n) => /\.(jpe?g|png|webp|gif)$/i.test(n));
  if (!pages.length) return fail('CBZ sem imagens');
  return { ok: true, metadata: { pages: pages.length } };
}

export function validateImage(buf: Buffer): ValidationResult {
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  return png || jpg || webp ? { ok: true, metadata: { type: png ? 'png' : jpg ? 'jpeg' : 'webp' } } : fail('Imagem inválida (apenas PNG/JPEG/WEBP)');
}

export async function validate(kind: Kind, buf: Buffer): Promise<ValidationResult> {
  switch (kind) {
    case 'EPUB': return validateEpub(buf);
    case 'PDF': return validatePdf(buf);
    case 'COMIC': return validateComic(buf);
    case 'COVER': case 'PREVIEW': return validateImage(buf);
    default: return fail(`Tipo ${kind} ainda não suportado`);
  }
}
