import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import * as pathPosix from 'path/posix';

/** Converte um EPUB num Readium Web Publication Manifest + lista de posições (o que o go-toolkit faria). */
const xml = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, trimValues: true, processEntities: true,
  isArray: (name) => ['item', 'itemref', 'meta', 'creator', 'title', 'language', 'identifier', 'navPoint', 'li', 'nav', 'ol', 'a', 'span'].includes(name),
});

const ordered = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, preserveOrder: true, trimValues: false });
type ONode = Record<string, any>;
const tag = (n: ONode) => Object.keys(n).find((k) => k !== ':@' && k !== '#text') ?? '';
const kids = (n: ONode): ONode[] => (n[tag(n)] as ONode[]) ?? [];
const attrs = (n: ONode): Record<string, string> => n[':@'] ?? {};
const innerText = (ns: ONode[]): string => ns.map((n) => (n['#text'] !== undefined ? String(n['#text']) : innerText(kids(n)))).join('').replace(/\s+/g, ' ').trim();
const findAll = (ns: ONode[], name: string, out: ONode[] = []): ONode[] => { for (const n of ns) { if (tag(n) === name) out.push(n); findAll(kids(n), name, out); } return out; };

export interface PubResource { path: string; type: string }
export interface ParsedPublication { manifest: any; positions: { total: number; positions: any[] }; resources: Map<string, PubResource> }

const text = (n: any): string => n == null ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : Object.entries(n).filter(([k]) => !k.startsWith('@_')).map(([, v]) => text(v)).join('');
const first = (a: any) => (Array.isArray(a) ? a[0] : a);
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const dec = (p: string) => { try { return decodeURIComponent(p); } catch { return p; } };
const resolve = (base: string, href: string) => { const [p, frag] = href.split('#'); const full = pathPosix.normalize(pathPosix.join(pathPosix.dirname(base), dec(p))); return { path: full, frag }; };
const toHref = (r: { path: string; frag?: string }) => enc(r.path) + (r.frag ? `#${r.frag}` : '');

export async function parseEpub(zip: JSZip): Promise<ParsedPublication> {
  const container = xml.parse(await zip.file('META-INF/container.xml')!.async('string'));
  const opfPath = first(container.container.rootfiles.rootfile)['@_full-path'] as string;
  const opf = xml.parse(await zip.file(opfPath)!.async('string')).package;
  const md = opf.metadata ?? {};
  const metas: any[] = md.meta ?? [];
  const meta = (prop: string) => text(metas.find((m) => m['@_property'] === prop));

  const items = new Map<string, { id: string; res: { path: string }; type: string; props: string[] }>();
  const byPath = new Map<string, PubResource>();
  for (const it of opf.manifest.item ?? []) {
    const r = resolve(opfPath, it['@_href']); const type = it['@_media-type'] ?? 'application/octet-stream';
    if (!zip.file(r.path)) continue; // item declarado mas ausente no arquivo
    items.set(it['@_id'], { id: it['@_id'], res: r, type, props: String(it['@_properties'] ?? '').split(/\s+/).filter(Boolean) });
    byPath.set(r.path, { path: r.path, type });
  }

  const fixed = meta('rendition:layout') === 'pre-paginated';
  const spineIds: string[] = (opf.spine.itemref ?? []).map((r: any) => r['@_idref']).filter((id: string) => items.has(id));
  const spinePaths = new Set(spineIds.map((id) => items.get(id)!.res.path));

  // --- TOC (nav EPUB3 ou NCX EPUB2)
  const navItem = [...items.values()].find((i) => i.props.includes('nav'));
  const ncxItem = [...items.values()].find((i) => i.type === 'application/x-dtbncx+xml');
  const tocOf = async (): Promise<any[]> => {
    if (navItem) {
      // Parser que preserva a ordem do documento (texto misto: «Capítulo <i>Um</i>»).
      const doc: ONode[] = ordered.parse(await zip.file(navItem.res.path)!.async('string'));
      const toc = findAll(doc, 'nav').find((n) => /(^|\s)toc(\s|$)/.test(String(attrs(n)['@_type'] ?? '')));
      const conv = (ol: ONode | undefined): any[] => !ol ? [] : kids(ol).filter((n) => tag(n) === 'li').map((li) => {
        const a = kids(li).find((n) => tag(n) === 'a' || tag(n) === 'span'); const href = a && attrs(a)['@_href'];
        const link: any = { title: a ? innerText(kids(a)) : '' };
        if (href) link.href = toHref(resolve(navItem.res.path, href));
        const sub = conv(kids(li).find((n) => tag(n) === 'ol')); if (sub.length) link.children = sub;
        return link;
      }).filter((l: any) => l.title || l.children);
      return toc ? conv(kids(toc).find((n) => tag(n) === 'ol')) : [];
    }
    if (ncxItem) {
      const ncx = xml.parse(await zip.file(ncxItem.res.path)!.async('string')).ncx;
      const conv = (pts: any[]): any[] => (pts ?? []).map((p: any) => {
        const link: any = { title: text(p.navLabel?.text ?? p.navLabel).trim(), href: toHref(resolve(ncxItem.res.path, p.content?.['@_src'] ?? '')) };
        const kids = conv(p.navPoint); if (kids.length) link.children = kids; return link;
      });
      return conv(ncx.navMap?.navPoint);
    }
    return [];
  };
  const toc = await tocOf().catch(() => []);
  const titleByPath = new Map<string, string>();
  const index = (ls: any[]) => ls.forEach((l) => { if (l.href && !titleByPath.has(dec(l.href.split('#')[0]))) titleByPath.set(dec(l.href.split('#')[0]), l.title); if (l.children) index(l.children); });
  index(toc);

  const link = (r: { path: string }, type: string, extra: any = {}) => ({ href: enc(r.path), type, ...(titleByPath.get(r.path) ? { title: titleByPath.get(r.path) } : {}), ...extra });
  const readingOrder = spineIds.map((id) => link(items.get(id)!.res, items.get(id)!.type));
  const resources = [...items.values()].filter((i) => !spinePaths.has(i.res.path)).map((i) => {
    const l: any = { href: enc(i.res.path), type: i.type }; if (i.props.includes('cover-image')) l.rel = 'cover'; return l;
  });

  // --- Posições: ~1 por 1024 bytes comprimidos de cada recurso (algoritmo do Readium); 1 por página em layout fixo
  const sizes = spineIds.map((id) => { const f: any = zip.file(items.get(id)!.res.path); return fixed ? 1 : Math.max(1, Math.ceil((f?._data?.compressedSize ?? f?._data?.uncompressedSize ?? 1024) / 1024)); });
  const total = sizes.reduce((a, b) => a + b, 0); const positions: any[] = []; let n = 0;
  spineIds.forEach((id, i) => { for (let k = 0; k < sizes[i]; k++) { n++; positions.push({ href: enc(items.get(id)!.res.path), type: items.get(id)!.type, locations: { position: n, progression: k / sizes[i], totalProgression: (n - 1) / total } }); } });

  const creators = (md.creator ?? []).map((c: any) => ({ name: text(c).trim() })).filter((c: any) => c.name);
  const lang = (md.language ?? []).map((l: any) => text(l).trim());
  const manifest: any = {
    '@context': 'https://readium.org/webpub-manifest/context.jsonld',
    metadata: {
      '@type': 'http://schema.org/Book', conformsTo: 'https://readium.org/webpub-manifest/profiles/epub',
      title: text(first(md.title)).trim() || 'Sem título', identifier: text(first(md.identifier)).trim(), language: lang,
      ...(creators.length ? { author: creators } : {}), ...(md.publisher ? { publisher: { name: text(md.publisher).trim() } } : {}),
      ...(meta('dcterms:modified') ? { modified: meta('dcterms:modified') } : {}),
      readingProgression: opf.spine['@_page-progression-direction'] === 'rtl' ? 'rtl' : 'ltr',
      ...(fixed ? { rendition: { layout: 'fixed' } } : {}),
    },
    links: [{ rel: 'self', href: 'manifest.json', type: 'application/webpub+json' },
            { rel: 'http://readium.org/positions', href: 'positions.json', type: 'application/vnd.readium.position-list+json' }],
    readingOrder, resources, toc,
  };
  return { manifest, positions: { total, positions }, resources: byPath };
}
