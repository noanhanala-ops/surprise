'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PdfReaderProps {
  editionId: string; title: string; contentUrl: string;
  progress: { locator: any; progress_percent: number; version: number } | null;
  bookmarks: { id: string; locator: any; title: string | null; created_at: string }[];
}
const bff = (path: string, init: RequestInit = {}) => fetch(`/api/bff/${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-requested-with': 'drp', ...(init.headers ?? {}) }, cache: 'no-store' });
const locatorFor = (page: number, total: number) => ({ href: 'pdf', type: 'application/pdf', locations: { position: page, progression: (page - 1) / Math.max(1, total), totalProgression: (page - 1) / Math.max(1, total) } });

/**
 * Leitor de PDF (PDF.js). Mesmo modelo de sincronização do EPUB: servidor = estado canónico, escrita por compare-and-set,
 * conflito ⇒ aviso (nunca sobrescreve em silêncio), só grava depois de uma acção do utilizador.
 * O PDF é descarregado uma vez, do mesmo origin, com um token de 5 min que revalida o direito.
 */
export default function PdfReader({ editionId, title, contentUrl, progress, bookmarks: initialMarks }: PdfReaderProps) {
  const holder = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  const pdf = useRef<any>(null); const task = useRef<any>(null);
  const version = useRef<number>(progress?.version ?? 0); const armed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); const lastSaved = useRef(''); const latest = useRef<{ page: number; total: number } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'); const [error, setError] = useState('');
  const [total, setTotal] = useState(0); const [page, setPage] = useState<number>(Math.max(1, Number(progress?.locator?.locations?.position) || 1));
  const [zoom, setZoom] = useState(1); const [marks, setMarks] = useState(initialMarks); const [panel, setPanel] = useState(false);
  const [remote, setRemote] = useState<{ page: number; percent: number } | null>(null); const [toast, setToast] = useState('');
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 2200); }, []);

  const save = useCallback(async (keepalive = false) => {
    const l = latest.current; if (!l || !armed.current) return;
    const body = JSON.stringify({ locator: locatorFor(l.page, l.total), progress_percent: Math.round((l.page / l.total) * 10000) / 100, base_version: version.current });
    if (body === lastSaved.current) return; lastSaved.current = body;
    const r = await bff(`reading/${editionId}/progress`, { method: 'PUT', body, keepalive }).catch(() => null); if (!r) return;
    if (r.ok) { version.current = (await r.json()).version; return; }
    if (r.status === 409) { const cur = (await r.json())?.current; lastSaved.current = ''; if (cur) { version.current = cur.version; setRemote({ page: Number(cur.locator?.locations?.position) || 1, percent: cur.progress_percent }); } }
  }, [editionId]);

  // Carrega o documento
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const lib: any = await import('pdfjs-dist');
        lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const doc = await lib.getDocument({ url: contentUrl }).promise; if (dead) return;
        pdf.current = doc; setTotal(doc.numPages); setPage((p) => Math.min(Math.max(1, p), doc.numPages)); setState('ready');
        bff(`reading/${editionId}/session`, { method: 'POST', body: '{}' }).catch(() => undefined);
      } catch (e: any) { if (!dead) { setError(e?.message ?? String(e)); setState('error'); } }
    })();
    return () => { dead = true; task.current?.cancel?.(); pdf.current?.destroy?.(); };
  }, [contentUrl, editionId]);

  // Desenha a página actual (largura ajustada ao ecrã × zoom, nítida em ecrãs de alta densidade)
  useEffect(() => {
    if (state !== 'ready' || !pdf.current || !canvas.current) return;
    let dead = false;
    (async () => {
      const pg = await pdf.current.getPage(page); if (dead) return;
      const avail = Math.min((holder.current?.clientWidth ?? 800) - 32, 1000); const base = pg.getViewport({ scale: 1 });
      const scale = (avail / base.width) * zoom; const vp = pg.getViewport({ scale }); const dpr = window.devicePixelRatio || 1;
      const c = canvas.current!; c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr); c.style.width = `${Math.floor(vp.width)}px`; c.style.height = `${Math.floor(vp.height)}px`;
      task.current?.cancel?.(); task.current = pg.render({ canvas: c, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      try { await task.current.promise; c.dataset.rendered = String(page); } catch { /* render cancelado por outra página */ }
    })();
    return () => { dead = true; };
  }, [state, page, zoom]);

  // Progresso: grava (debounce) só depois de acção do utilizador
  useEffect(() => {
    if (state !== 'ready' || !total) return;
    latest.current = { page, total };
    if (!armed.current) return;
    if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => save(), 1000);
  }, [page, total, state, save]);
  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') save(true); };
    document.addEventListener('visibilitychange', flush); window.addEventListener('pagehide', () => save(true));
    return () => { document.removeEventListener('visibilitychange', flush); if (timer.current) clearTimeout(timer.current); };
  }, [save]);

  const goto = useCallback((p: number) => { armed.current = true; setPage(Math.min(Math.max(1, p), total || 1)); holder.current?.scrollTo({ top: 0 }); }, [total]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goto(page + 1); else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goto(page - 1);
      else if (e.key === 'Home') goto(1); else if (e.key === 'End') goto(total);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [goto, page, total]);

  const addMark = async () => {
    const r = await bff(`reading/${editionId}/bookmarks`, { method: 'POST', body: JSON.stringify({ locator: locatorFor(page, total), title: `Página ${page}` }) });
    if (r.ok) { const b = await r.json(); setMarks((m) => [...m, { id: b.id, locator: locatorFor(page, total), title: `Página ${page}`, created_at: b.created_at }]); flash('Marcador guardado'); }
  };
  const removeMark = async (id: string) => { if ((await bff(`reading/${editionId}/bookmarks/${id}`, { method: 'DELETE' })).ok) setMarks((m) => m.filter((x) => x.id !== id)); };
  const pct = total ? Math.round((page / total) * 100) : 0;

  return (
    <div className="rd-shell pdf-shell" data-testid="pdf-reader" data-state={state}>
      <div className="rd-bar rd-top">
        <Link href="/library" aria-label="Voltar à biblioteca">←</Link><strong className="rd-title">{title}</strong><span className="rd-spacer" />
        <button onClick={() => { armed.current = true; setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100)); }} aria-label="Diminuir zoom">−</button>
        <span aria-live="polite" data-testid="pdf-zoom">{Math.round(zoom * 100)}%</span>
        <button onClick={() => { armed.current = true; setZoom((z) => Math.min(3, Math.round((z + 0.15) * 100) / 100)); }} aria-label="Aumentar zoom">+</button>
        <button onClick={addMark} aria-label="Adicionar marcador">🔖</button>
        <button onClick={() => setPanel((v) => !v)} aria-pressed={panel} aria-label="Marcadores">Marcadores ({marks.length})</button>
      </div>
      {remote && (<div className="rd-banner" role="status">Outro dispositivo avançou para a página {remote.page} ({Math.round(remote.percent)}%).
        <button onClick={() => { setPage(remote.page); setRemote(null); }}>Ir para lá</button><button onClick={() => setRemote(null)}>Ficar aqui</button></div>)}
      <div className="rd-body">
        <div ref={holder} className="pdf-holder"><canvas ref={canvas} data-testid="pdf-canvas" aria-label={`Página ${page} de ${total}`} /></div>
        {state === 'loading' && <p className="rd-msg">A abrir o PDF…</p>}
        {state === 'error' && <p className="rd-msg" role="alert">Não foi possível abrir o PDF ({error}). <button onClick={() => window.location.reload()}>Tentar de novo</button></p>}
        {panel && (<aside className="rd-panel" aria-label="Marcadores" style={{ background: 'var(--card)', color: 'var(--fg)' }}>
          {marks.length ? <ul>{marks.map((m) => <li key={m.id}><button onClick={() => { goto(Number(m.locator?.locations?.position) || 1); setPanel(false); }}>{m.title ?? 'Marcador'}</button><button aria-label="Apagar marcador" onClick={() => removeMark(m.id)}>✕</button></li>)}</ul> : <p className="muted">Sem marcadores.</p>}</aside>)}
      </div>
      <div className="rd-bar rd-bottom">
        <button onClick={() => goto(page - 1)} disabled={page <= 1} aria-label="Página anterior">‹</button>
        <div className="rd-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
        <label className="pdf-goto">Pág. <input type="number" min={1} max={total || 1} value={page} data-testid="pdf-page" onChange={(e) => { const n = parseInt(e.target.value, 10); if (n) goto(n); }} /> / <span data-testid="pdf-total">{total}</span></label>
        <span data-testid="pct">{pct}%</span>
        <button onClick={() => goto(page + 1)} disabled={page >= total} aria-label="Página seguinte">›</button>
      </div>
      {toast && <div className="rd-toast" role="status">{toast}</div>}
    </div>
  );
}
