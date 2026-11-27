import JSZip from 'jszip';
import { deflateSync } from 'zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function makeEpub(title: string, opts: { badMimetype?: boolean } = {}) {
  const z = new JSZip();
  z.file('mimetype', opts.badMimetype ? 'text/plain' : 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:language>pt</dc:language><dc:identifier>urn:uuid:1</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`);
  z.file('OEBPS/c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Olá</p></body></html>');
  return z.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

/** EPUB 3 realista: nav com TOC aninhado, capa, 3 capítulos (um grande → várias posições), ficheiro com espaço no nome. */
export async function makeRichEpub(title: string, o: { chapters?: number } = {}) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('META-INF/encryption.xml', '<encryption/>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:identifier id="id">urn:uuid:rich-1</dc:identifier><dc:title>${title}</dc:title><dc:creator>Mia Couto</dc:creator><dc:creator>Outro Autor</dc:creator><dc:language>pt</dc:language><dc:publisher>Editora X</dc:publisher><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="cap%20dois.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="text/c3.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>`);
  z.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Capítulo <i>Um</i></a></li><li><a href="cap%20dois.xhtml">Capítulo Dois</a><ol><li><a href="cap%20dois.xhtml#s1">Secção 2.1</a></li></ol></li><li><a href="text/c3.xhtml">Capítulo Três</a></li></ol></nav><nav epub:type="landmarks"><ol><li><a href="c1.xhtml">Início</a></li></ol></nav></body></html>`);
  z.file('OEBPS/images/cover.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]));
  z.file('OEBPS/style.css', 'body{font-family:serif}');
  const para = '<p>' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40) + '</p>';
  z.file('OEBPS/c1.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><h1>Um</h1>${para.repeat(30)}</body></html>`, { compression: 'STORE' });
  z.file('OEBPS/cap dois.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="s1">Dois</h1>${para}</body></html>`);
  z.file('OEBPS/text/c3.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Três</h1><p>Fim.</p></body></html>');
  return z.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}


/** PNG real (cor sólida em gradiente vertical) para capas de demonstração. */
export function makePng(w: number, h: number, top: [number, number, number], bottom: [number, number, number]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) { const t = y / (h - 1); const px = [0, 1, 2].map((i) => Math.round(top[i] + (bottom[i] - top[i]) * t)); rows.push(Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => px).flat())])); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

/** PDF real e válido (xref correcto) com `pages` páginas, cada uma com o número bem visível — para testar o leitor. */
export async function makePdf(title: string, pages = 12) {
  const doc = await PDFDocument.create(); doc.setTitle(title); const font = await doc.embedFont(StandardFonts.HelveticaBold); const body = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([420, 594]); p.drawRectangle({ x: 0, y: 0, width: 420, height: 594, color: rgb(0.99, 0.97, 0.93) });
    p.drawText(title, { x: 30, y: 540, size: 16, font, color: rgb(0.35, 0.15, 0.1) });
    p.drawText(`Página ${i}`, { x: 120, y: 330, size: 48, font, color: rgb(0.2, 0.2, 0.2) });
    p.drawText(`de ${pages}`, { x: 175, y: 290, size: 20, font: body, color: rgb(0.4, 0.4, 0.4) });
  }
  return Buffer.from(await doc.save());
}
