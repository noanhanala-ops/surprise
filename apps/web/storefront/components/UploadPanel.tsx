'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const KINDS = { EPUB: { label: 'Ficheiro EPUB', accept: '.epub,application/epub+zip', mime: 'application/epub+zip' }, COVER: { label: 'Capa (PNG/JPEG/WebP)', accept: 'image/png,image/jpeg,image/webp', mime: '' } } as const;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const bff = (path: string, body: unknown) => fetch(`/api/bff/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'drp' }, body: JSON.stringify(body), cache: 'no-store' });

/**
 * Upload no browser: calcula o SHA-256, pede a URL de upload à API e envia o ficheiro —
 * directo ao bucket (modo `direct`, produção) ou pelo mesmo origin (modo `proxy`, dev).
 * O servidor valida tamanho, checksum e conteúdo; qualquer erro é mostrado tal como a API o devolve.
 */
export default function UploadPanel({ editionId, disabled }: { editionId: string; disabled?: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function send(kind: keyof typeof KINDS, file: File) {
    setBusy(kind); setMsg(null);
    try {
      const buf = await file.arrayBuffer(); const sha = hex(await crypto.subtle.digest('SHA-256', buf));
      const mime = kind === 'EPUB' ? 'application/epub+zip' : file.type || 'application/octet-stream';
      const ir = await bff(`publisher/books/${editionId}/assets`, { kind, mime_type: mime, size_bytes: file.size, checksum_sha256: sha });
      if (!ir.ok) throw new Error((await ir.json().catch(() => ({})))?.message ?? `Pedido de upload recusado (${ir.status})`);
      const intent = await ir.json();
      let res: Response;
      if (intent.mode === 'direct') {
        const put = await fetch(intent.url, { method: 'PUT', headers: intent.headers, body: buf }); if (!put.ok) throw new Error(`O armazenamento recusou o ficheiro (${put.status})`);
        res = await bff('uploads/complete', { upload_token: intent.upload_token });
      } else res = await fetch(new URL(intent.url).pathname, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buf });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(Array.isArray(j.message) ? j.message.join('; ') : j.message ?? `Falhou (${res.status})`);
      setMsg({ kind: 'ok', text: `${KINDS[kind].label}: carregado e validado.` });
    } catch (e: any) { setMsg({ kind: 'err', text: e.message ?? String(e) }); }
    finally { setBusy(null); router.refresh(); }
  }

  return (
    <div className="row">
      {(Object.keys(KINDS) as (keyof typeof KINDS)[]).map((k) => (
        <label key={k}>{KINDS[k].label}
          <input type="file" accept={KINDS[k].accept} disabled={disabled || busy !== null} data-testid={`upload-${k}`}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) send(k, f); e.target.value = ''; }} />
          {busy === k && <progress aria-label="A enviar" />}
        </label>))}
      {msg && <p className={`alert ${msg.kind === 'ok' ? 'ok' : 'err'}`} role={msg.kind === 'ok' ? 'status' : 'alert'} data-testid="upload-msg" style={{ flexBasis: '100%' }}>{msg.text}</p>}
    </div>
  );
}
