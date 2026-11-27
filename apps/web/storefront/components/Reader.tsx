'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ReaderProps {
  editionId: string; title: string; manifestUrl: string;
  progress: { locator: any; progress_percent: number; version: number } | null;
  bookmarks: { id: string; locator: any; title: string | null; created_at: string }[];
  highlights: { id: string; locator: any; selected_text: string; color: string | null }[];
  notes: { id: string; highlight_id: string; content: string }[];
  prefs: { theme?: string; font_size?: number };
}
type Theme = 'LIGHT' | 'SEPIA' | 'DARK';
const THEMES: Record<Theme, { backgroundColor: string; textColor: string }> = {
  LIGHT: { backgroundColor: '#ffffff', textColor: '#1a1a1a' }, SEPIA: { backgroundColor: '#f4ecd8', textColor: '#5b4636' }, DARK: { backgroundColor: '#121212', textColor: '#e2e2e2' },
};
const BASE_PX = 16;
const HL_COLORS: Record<string, { label: string; tint: string }> = { yellow: { label: 'amarelo', tint: '#ffe066' }, green: { label: 'verde', tint: '#8ce99a' }, pink: { label: 'rosa', tint: '#ffa8c5' }, blue: { label: 'azul', tint: '#a5d8ff' } };
interface Hl { id: string; locator: any; text: string; color: string; note: string }
interface Sel { text: string; locator: any }
const bff = (path: string, init: RequestInit = {}) => fetch(`/api/bff/${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-requested-with': 'drp', ...(init.headers ?? {}) }, cache: 'no-store' });

interface TocItem { title: string; link: any; depth: number }
const flattenToc = (links: any[] | undefined, depth = 0): TocItem[] => (links ?? []).flatMap((l: any) => [{ title: l.title ?? '—', link: l, depth }, ...flattenToc(l.children?.items ?? l.children, depth + 1)]);

function NoteEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value); const dirty = v.trim() !== value.trim();
  return (<div className="rd-note"><textarea aria-label="Nota" value={v} onChange={(e) => setV(e.target.value)} placeholder="Juntar uma nota…" rows={2} />
    {dirty && <button onClick={() => onSave(v)} aria-label="Guardar nota">Guardar nota</button>}</div>);
}

export default function Reader({ editionId, title, manifestUrl, progress, bookmarks: initialBookmarks, highlights: initialHl, notes: initialNotes, prefs }: ReaderProps) {
  const container = useRef<HTMLDivElement>(null);
  const nav = useRef<any>(null); const Locator = useRef<any>(null);
  const version = useRef<number>(progress?.version ?? 0);
  // `armed`: só grava depois de uma acção real do utilizador
  const latest = useRef<any>(null); const armed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); const lastSaved = useRef<string>('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'); const [error, setError] = useState('');
  const [pct, setPct] = useState(progress?.progress_percent ?? 0); const [chapter, setChapter] = useState('');
  const [panel, setPanel] = useState<null | 'toc' | 'marks' | 'notes'>(null); const [toc, setToc] = useState<TocItem[]>([]);
  const [theme, setTheme] = useState<Theme>((['LIGHT', 'SEPIA', 'DARK'].includes(prefs.theme ?? '') ? prefs.theme : 'LIGHT') as Theme);
  const [size, setSize] = useState<number>(prefs.font_size ? prefs.font_size / BASE_PX : 1);
  const [marks, setMarks] = useState(initialBookmarks); const [remote, setRemote] = useState<{ locator: any; percent: number } | null>(null);
  const [toast, setToast] = useState('');
  const [hls, setHls] = useState<Hl[]>(() => initialHl.map((h) => ({ id: h.id, locator: h.locator, text: h.selected_text, color: h.color && HL_COLORS[h.color] ? h.color : 'yellow', note: initialNotes.find((n) => n.highlight_id === h.id)?.content ?? '' })));
  const [sel, setSel] = useState<Sel | null>(null); const [noteDraft, setNoteDraft] = useState<string | null>(null); const [focusHl, setFocusHl] = useState<string | null>(null);
  const DecoStyle = useRef<any>(null); const [decoReady, setDecoReady] = useState(false);

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); }, []);

  /** Guarda o progresso com compare-and-set. Em conflito (outro dispositivo avançou) NÃO sobrescreve: avisa e deixa o utilizador escolher. */
  const save = useCallback(async (keepalive = false) => {
    const loc = latest.current; if (!loc) return;
    const body = JSON.stringify({ locator: loc.locator, progress_percent: loc.percent, base_version: version.current });
    if (body === lastSaved.current) return; lastSaved.current = body;
    const r = await bff(`reading/${editionId}/progress`, { method: 'PUT', body, keepalive }).catch(() => null);
    if (!r) return;
    if (r.ok) { version.current = (await r.json()).version; return; }
    if (r.status === 409) {
      const cur = (await r.json())?.current; lastSaved.current = '';
      if (cur) { version.current = cur.version; setRemote({ locator: cur.locator, percent: cur.progress_percent }); } // a próxima gravação já parte da versão do servidor
    }
  }, [editionId]);

  useEffect(() => {
    let destroyed = false; let expiry: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        const shared = await import('@readium/shared'); const navMod = await import('@readium/navigator');
        Locator.current = shared.Locator;
        const selfHref = new URL(manifestUrl, window.location.href).toString();
        const res = await fetch(manifestUrl, { cache: 'no-store' }); if (!res.ok) throw new Error(`manifesto ${res.status}`);
        const manifest = shared.Manifest.deserialize(await res.json()); if (!manifest) throw new Error('manifesto inválido'); manifest.setSelfLink(selfHref);
        const publication = new shared.Publication({ manifest, fetcher: new shared.HttpFetcher(undefined, selfHref) });
        const positions = await publication.positionsFromManifest();
        if (destroyed) return;
        setToc(flattenToc((publication.manifest.toc as any)?.items ?? (publication.manifest.toc as any)));
        const initial = progress?.locator ? shared.Locator.deserialize(progress.locator) : undefined;
        const navigator = new navMod.EpubNavigator(container.current!, publication, {
          frameLoaded: () => undefined,
          positionChanged: (loc: any) => {
            const total = Math.min(1, Math.max(0, loc.locations?.totalProgression ?? 0));
            latest.current = { locator: loc.serialize(), percent: Math.round(total * 10000) / 100 };
            setPct(latest.current.percent); setChapter(loc.title ?? '');
            if (!armed.current) return; // o Readium emite positionChanged ao restaurar/reajustar: não é leitura, não grava (evita conflitos falsos)
            if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => save(), 1200); // debounce
          },
          tap: () => { armed.current = true; return false; }, click: () => { armed.current = true; return false; }, zoom: () => undefined, scroll: () => { armed.current = true; }, miscPointer: () => undefined, customEvent: () => undefined,
          handleLocator: () => false, textSelected: (selection: any) => {
            if (!selection?.locator || !selection.text?.trim()) return;
            // Posição EXACTA da selecção (domRange: nó + deslocamento) e, como reserva, o contexto antes/depois. Só o contexto não chega:
            // num texto com frases repetidas o destaque cairia na primeira ocorrência. O Readium resolve o domRange antes do texto.
            let before = ''; let after = ''; let domRange: any = null;
            const cssPath = (el: Element): string => { const parts: string[] = []; let e: Element | null = el; // XHTML é XML: os nomes são minúsculos (tagName !== 'BODY'), por isso compara-se por localName
            while (e && e.localName !== 'html') { if (e.localName === 'body') { parts.unshift('body'); break; } const i = Array.from(e.parentElement?.children ?? []).indexOf(e) + 1; parts.unshift(`${e.localName}:nth-child(${i})`); e = e.parentElement; } return parts.join(' > '); };
            const point = (n: Node, off: number) => { if (n.nodeType !== Node.TEXT_NODE || !n.parentElement) return null; let idx = 0; for (const c of Array.from(n.parentElement.childNodes)) { if (c === n) break; if (c.nodeType === Node.TEXT_NODE) idx++; } return { cssSelector: cssPath(n.parentElement), textNodeIndex: idx, charOffset: off }; };
            for (const f of Array.from(container.current?.querySelectorAll('iframe') ?? [])) {
              if (getComputedStyle(f).visibility !== 'visible') continue;
              const r = f.contentWindow?.getSelection()?.rangeCount ? f.contentWindow!.getSelection()!.getRangeAt(0) : null; if (!r) continue;
              before = (r.startContainer.textContent ?? '').slice(Math.max(0, r.startOffset - 40), r.startOffset); after = (r.endContainer.textContent ?? '').slice(r.endOffset, r.endOffset + 40);
              const a = point(r.startContainer, r.startOffset); const b = point(r.endContainer, r.endOffset); if (a && b) domRange = { start: a, end: b };
              break;
            }
            const loc = selection.locator.serialize(); loc.text = { highlight: selection.text, before, after };
            if (domRange) loc.locations = { ...(loc.locations ?? {}), domRange };
            setSel({ text: selection.text, locator: loc }); setNoteDraft(null);
          }, contentProtection: () => undefined, contextMenu: () => undefined, peripheral: () => undefined,
        } as any, positions, initial, { preferences: { ...THEMES[theme], fontSize: size }, defaults: {} } as any);
        nav.current = navigator; DecoStyle.current = navMod.DecorationStyleType; await navigator.load();
        navigator.registerDecorationObserver('user-highlights', { onDecorationActivated: (ev: any) => { setFocusHl(ev.decoration.id); setPanel('notes'); return true; } });
        setDecoReady(true);
        if (destroyed) return;
        setState('ready'); bff(`reading/${editionId}/session`, { method: 'POST', body: '{}' }).catch(() => undefined);
        expiry = setTimeout(async () => { await save(); window.location.reload(); }, 55 * 60_000); // o token de leitura dura 1 h
      } catch (e: any) { if (!destroyed) { setError(e?.message ?? String(e)); setState('error'); } }
    })();
    const flush = () => { if (document.visibilityState === 'hidden') save(true); };
    document.addEventListener('visibilitychange', flush); window.addEventListener('pagehide', () => save(true));
    return () => { destroyed = true; clearTimeout(expiry); if (timer.current) clearTimeout(timer.current); document.removeEventListener('visibilitychange', flush); nav.current?.destroy?.(); nav.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestUrl]);

  // Os destaques desenham-se com a Decorator API do Readium (grupo "user-highlights"); reaplicam-se sozinhos ao mudar de capítulo.
  useEffect(() => {
    if (!decoReady || !nav.current || !Locator.current) return;
    nav.current.applyDecorations(hls.map((h) => ({ id: h.id, locator: Locator.current.deserialize(h.locator), style: { type: DecoStyle.current.Highlight, tint: HL_COLORS[h.color]?.tint ?? '#ffe066' } })), 'user-highlights');
  }, [hls, decoReady]);

  const createHighlight = async (color: string, note?: string) => {
    if (!sel) return;
    const r = await bff(`reading/${editionId}/highlights`, { method: 'POST', body: JSON.stringify({ locator: sel.locator, selected_text: sel.text.slice(0, 5000), color, note: note?.trim() || undefined }) });
    if (!r.ok) { flash('Não foi possível guardar o destaque'); return; }
    const h = await r.json(); setHls((x) => [...x, { id: h.id, locator: sel.locator, text: sel.text, color, note: note?.trim() ?? '' }]);
    setSel(null); setNoteDraft(null); flash(note?.trim() ? 'Destaque e nota guardados' : 'Destaque guardado');
  };
  const patchHighlight = async (id: string, patch: { color?: string; note?: string }) => {
    const r = await bff(`reading/${editionId}/highlights/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    if (r.ok) setHls((x) => x.map((h) => (h.id === id ? { ...h, ...(patch.color ? { color: patch.color } : {}), ...(patch.note !== undefined ? { note: patch.note.trim() } : {}) } : h)));
  };
  const removeHighlight = async (id: string) => { if ((await bff(`reading/${editionId}/highlights/${id}`, { method: 'DELETE' })).ok) setHls((x) => x.filter((h) => h.id !== id)); };

  const go = (dir: 'next' | 'prev') => (armed.current = true, setSel(null), dir === 'next' ? nav.current?.goForward(true, () => undefined) : nav.current?.goBackward(true, () => undefined));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === 'PageDown') go('next'); else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go('prev'); else if (e.key === 'Escape') setPanel(null); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  const applyPrefs = (t: Theme, s: number) => { armed.current = true; nav.current?.submitPreferences({ ...THEMES[t], fontSize: s }); bff('reading/preferences', { method: 'PUT', body: JSON.stringify({ theme: t, font_size: Math.round(BASE_PX * s) }) }).catch(() => undefined); };
  const changeSize = (d: number) => { const s = Math.min(2.4, Math.max(0.7, Math.round((size + d) * 10) / 10)); setSize(s); applyPrefs(theme, s); };
  const changeTheme = (t: Theme) => { setTheme(t); applyPrefs(t, size); };

  const addMark = async () => {
    const loc = latest.current; if (!loc) return;
    const r = await bff(`reading/${editionId}/bookmarks`, { method: 'POST', body: JSON.stringify({ locator: loc.locator, title: chapter || `${Math.round(loc.percent)}%` }) });
    if (r.ok) { const b = await r.json(); setMarks((m) => [...m, { id: b.id, locator: loc.locator, title: chapter || `${Math.round(loc.percent)}%`, created_at: b.created_at }]); flash('Marcador guardado'); }
  };
  const removeMark = async (id: string) => { if ((await bff(`reading/${editionId}/bookmarks/${id}`, { method: 'DELETE' })).ok) setMarks((m) => m.filter((x) => x.id !== id)); };
  const goTo = (locatorJson: any) => { armed.current = true; nav.current?.go(Locator.current.deserialize(locatorJson), true, () => undefined); setPanel(null); };
  const goLink = (link: any) => { armed.current = true; nav.current?.goLink(link, true, () => undefined); setPanel(null); };

  const t = THEMES[theme];
  return (
    <div className="rd-shell" style={{ background: t.backgroundColor, color: t.textColor }} data-testid="reader" data-state={state}>
      <div className="rd-bar rd-top">
        <Link href="/library" aria-label="Voltar à biblioteca">←</Link>
        <strong className="rd-title">{title}</strong>
        <span className="rd-spacer" />
        <button onClick={() => setPanel(panel === 'toc' ? null : 'toc')} aria-label="Índice" aria-pressed={panel === 'toc'}>Índice</button>
        <button onClick={addMark} aria-label="Adicionar marcador">🔖</button>
        <button onClick={() => setPanel(panel === 'marks' ? null : 'marks')} aria-label="Marcadores" aria-pressed={panel === 'marks'}>Marcadores ({marks.length})</button>
        <button onClick={() => setPanel(panel === 'notes' ? null : 'notes')} aria-label="Destaques e notas" aria-pressed={panel === 'notes'}>Notas ({hls.length})</button>
        <button onClick={() => changeSize(-0.1)} aria-label="Diminuir letra">A−</button><button onClick={() => changeSize(0.1)} aria-label="Aumentar letra">A+</button>
        {(['LIGHT', 'SEPIA', 'DARK'] as Theme[]).map((x) => <button key={x} onClick={() => changeTheme(x)} aria-pressed={theme === x} aria-label={`Tema ${x}`} className="rd-theme" style={{ background: THEMES[x].backgroundColor, borderColor: THEMES[x].textColor }} />)}
      </div>
      {remote && (
        <div className="rd-banner" role="status">Outro dispositivo avançou para {Math.round(remote.percent)}%.
          <button onClick={() => { goTo(remote.locator); setRemote(null); }}>Ir para lá</button><button onClick={() => setRemote(null)}>Ficar aqui</button></div>)}
      <div className="rd-body">
        <div ref={container} className="rd-container" data-testid="reader-container" />
        {state === 'loading' && <p className="rd-msg">A abrir o livro…</p>}
        {state === 'error' && <p className="rd-msg" role="alert">Não foi possível abrir o livro ({error}). <button onClick={() => window.location.reload()}>Tentar de novo</button></p>}
        {panel && (
          <aside className="rd-panel" aria-label={panel === 'toc' ? 'Índice' : panel === 'notes' ? 'Destaques e notas' : 'Marcadores'}>
            {panel === 'toc' ? (toc.length ? <ul>{toc.map((i, k) => <li key={k} style={{ paddingLeft: i.depth * 14 }}><button onClick={() => goLink(i.link)}>{i.title}</button></li>)}</ul> : <p className="muted">Este livro não tem índice.</p>)
              : panel === 'notes' ? (hls.length === 0 ? <p className="muted">Seleccione texto no livro para o destacar ou lhe juntar uma nota.</p> : (
                <ul data-testid="highlights">{hls.map((h) => (
                  <li key={h.id} className="rd-hl" data-focused={focusHl === h.id || undefined} data-testid="highlight-item">
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button onClick={() => goTo(h.locator)} style={{ flex: 1, textAlign: 'left', borderLeft: `4px solid ${HL_COLORS[h.color]?.tint}`, paddingLeft: 8 }}>“{h.text.length > 90 ? h.text.slice(0, 90) + '…' : h.text}”</button>
                      <button aria-label="Apagar destaque" onClick={() => removeHighlight(h.id)}>✕</button>
                    </div>
                    <div className="rd-colors">{Object.entries(HL_COLORS).map(([k, c]) => <button key={k} aria-label={`Cor ${c.label}`} aria-pressed={h.color === k} onClick={() => patchHighlight(h.id, { color: k })} style={{ background: c.tint }} />)}</div>
                    <NoteEditor value={h.note} onSave={(v) => patchHighlight(h.id, { note: v })} />
                  </li>))}</ul>))
              : (marks.length ? <ul>{marks.map((m) => <li key={m.id}><button onClick={() => goTo(m.locator)}>{m.title ?? 'Marcador'}</button><button aria-label="Apagar marcador" onClick={() => removeMark(m.id)}>✕</button></li>)}</ul> : <p className="muted">Sem marcadores.</p>)}
          </aside>)}
      </div>
      {sel && (
        <div className="rd-sel" role="toolbar" aria-label="Acções sobre o texto seleccionado" data-testid="selection-bar">
          <span className="rd-sel-text">“{sel.text.length > 60 ? sel.text.slice(0, 60) + '…' : sel.text}”</span>
          {noteDraft === null ? (<>
            {Object.entries(HL_COLORS).map(([k, c]) => <button key={k} aria-label={`Destacar a ${c.label}`} onClick={() => createHighlight(k)} style={{ background: c.tint }} className="rd-swatch" />)}
            <button onClick={() => setNoteDraft('')} aria-label="Adicionar nota">Nota</button></>) : (<>
            <input aria-label="Texto da nota" autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && noteDraft.trim()) createHighlight('yellow', noteDraft); }} placeholder="A sua nota…" />
            <button onClick={() => createHighlight('yellow', noteDraft)} disabled={!noteDraft.trim()} aria-label="Guardar nota">Guardar</button></>)}
          <button onClick={() => { setSel(null); setNoteDraft(null); }} aria-label="Fechar">✕</button>
        </div>)}
      <div className="rd-bar rd-bottom">
        <button onClick={() => go('prev')} aria-label="Página anterior">‹</button>
        <div className="rd-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
        <span data-testid="pct">{Math.round(pct)}%</span><span className="rd-chap">{chapter}</span>
        <button onClick={() => go('next')} aria-label="Página seguinte">›</button>
      </div>
      {toast && <div className="rd-toast" role="status">{toast}</div>}
    </div>
  );
}
