import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Denied, Notice, Status } from '@/components/PortalChrome';
import UploadPanel from '@/components/UploadPanel';
import { safe } from '@/lib/api';
import { submitBookAction, updateBookAction } from '@/lib/portal-actions';
import { dateFmt, money, STATUS_PT } from '@/lib/format';

export const dynamic = 'force-dynamic';
interface Detail { id: string; status: string; title: string; description: string | null; isbn: string | null; language_code: string; slug: string;
  prices: { currency: string; amount_minor: number }[]; formats: { version_id: string; format: string; version_number: number; status: string; rejection_reason: string | null; size_bytes: number; created_at: string; is_current: boolean }[];
  assets: { id: string; asset_type: string }[]; contracts: { id: string; status: string; commission_bps: number; territories: { country_code: string; permission_type: string }[] | null }[]; last_rejection: { reason: string; created_at: string } | null }

export default async function BookDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params; const q = await searchParams; const r = await safe<Detail>(`/publisher/books/${id}`, `/publisher/books/${id}`);
  if (!r.ok) { if (r.status === 404) notFound(); return <Denied {...r} />; }
  const d = r.data; const editable = d.status === 'DRAFT'; const hasReady = d.formats.some((f) => f.status === 'READY' && f.is_current);
  const price = (c: string) => { const p = d.prices.find((x) => x.currency === c); return p ? (p.amount_minor / 100).toFixed(2).replace('.', ',') : ''; };
  return (
    <>
      <p><Link href="/publisher">← Os meus livros</Link></p>
      <h1>{d.title} <Status s={d.status} label={STATUS_PT[d.status] ?? d.status} /></h1><Notice error={q.error} ok={q.ok} />
      {d.last_rejection && d.status === 'DRAFT' && <p className="alert err" data-testid="rejection">Devolvido pela revisão ({dateFmt(d.last_rejection.created_at)}): <strong>{d.last_rejection.reason}</strong></p>}

      <section className="panel"><h2>Dados e preços</h2>
        <form className="wide" action={updateBookAction}>
          <input type="hidden" name="id" value={d.id} />
          <label>Título<input name="title" required defaultValue={d.title} disabled={!editable} /></label>
          <label>Descrição<textarea name="description" defaultValue={d.description ?? ''} disabled={!editable} /></label>
          <div className="row"><label>Idioma<input name="language_code" defaultValue={d.language_code} disabled={!editable} /></label><label>ISBN<input name="isbn" defaultValue={d.isbn ?? ''} disabled={!editable} /></label></div>
          <div className="row">{['USD', 'MZN', 'EUR'].map((c) => <label key={c}>{c}<input name={`price_${c}`} defaultValue={price(c)} disabled={!editable} inputMode="decimal" /></label>)}</div>
          {editable ? <button type="submit">Guardar</button> : <p className="muted">Só é possível editar enquanto a edição está em rascunho.</p>}
        </form></section>

      <section className="panel"><h2>Ficheiros</h2>
        <UploadPanel editionId={d.id} disabled={!['DRAFT', 'IN_REVIEW'].includes(d.status)} />
        {d.formats.length > 0 && (
          <table className="table" style={{ marginTop: 14 }} data-testid="formats"><thead><tr><th>Formato</th><th>Versão</th><th>Estado</th><th className="num">Tamanho</th><th>Detalhe</th></tr></thead><tbody>
            {d.formats.map((f) => <tr key={f.version_id}><td>{f.format}{f.is_current && ' ✓'}</td><td>v{f.version_number}</td><td><Status s={f.status} label={STATUS_PT[f.status] ?? f.status} /></td><td className="num">{(f.size_bytes / 1024).toFixed(0)} KB</td><td>{f.rejection_reason ?? ''}</td></tr>)}
          </tbody></table>)}
        <p className="muted">Capas: {d.assets.filter((a) => a.asset_type === 'COVER').length}. Não são aceites EPUBs com scripts nem ficheiros corrompidos.</p></section>

      <section className="panel"><h2>Direitos de venda</h2>
        {d.contracts.length === 0 ? <p className="muted">Sem contrato ainda. A administração define comissão e territórios na revisão.</p> : d.contracts.map((c) => (
          <p key={c.id}>Plataforma {(c.commission_bps / 100).toFixed(0)} % · territórios: {(c.territories ?? []).map((t) => `${t.permission_type === 'DENY' ? '✕' : ''}${t.country_code}`).join(', ')}</p>))}</section>

      {editable && <form action={submitBookAction}><input type="hidden" name="id" value={d.id} />
        <button type="submit" disabled={!hasReady || d.prices.length === 0} data-testid="submit-review">Submeter para revisão</button>
        {(!hasReady || d.prices.length === 0) && <span className="muted"> {!hasReady ? 'Carregue um EPUB válido. ' : ''}{d.prices.length === 0 ? 'Defina pelo menos um preço.' : ''}</span>}</form>}
      {d.status === 'PUBLISHED' && <p><Link className="btn" href={`/books/${d.slug}`}>Ver na loja</Link> <span className="muted">{d.prices.map((p) => money(p.amount_minor, p.currency)).join(' · ')}</span></p>}
    </>);
}
