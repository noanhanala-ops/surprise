import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Denied, Notice, Status } from '@/components/PortalChrome';
import { safe } from '@/lib/api';
import { approveBookAction, createContractAction, rejectBookAction, suspendBookAction } from '@/lib/portal-actions';
import { dateFmt, money, STATUS_PT } from '@/lib/format';

export const dynamic = 'force-dynamic';
interface D { id: string; status: string; title: string; description: string | null; isbn: string | null; language_code: string; publisher: string; publisher_status: string;
  prices: { currency: string; amount_minor: number }[]; formats: { format: string; version_number: number; status: string; rejection_reason: string | null; size_bytes: number; metadata: Record<string, any>; is_current: boolean }[];
  contracts: { id: string; status: string; start_at: string; commission_bps: number; territories: { country_code: string; permission_type: string }[] | null }[]; history: { action: string; actor_type: string; reason: string | null; created_at: string }[] }

export default async function ReviewDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params; const q = await searchParams; const r = await safe<D>(`/admin/books/${id}`, `/admin/reviews/${id}`);
  if (!r.ok) { if (r.status === 404) notFound(); return <Denied {...r} />; }
  const d = r.data; const active = d.contracts.find((c) => c.status === 'ACTIVE');
  return (
    <>
      <p><Link href="/admin/reviews">← Livros</Link></p>
      <h1>{d.title} <Status s={d.status} label={STATUS_PT[d.status] ?? d.status} /></h1><Notice error={q.error} ok={q.ok} />
      <p className="muted">Editora: <strong>{d.publisher}</strong> ({STATUS_PT[d.publisher_status] ?? d.publisher_status}) · idioma {d.language_code}{d.isbn ? ` · ISBN ${d.isbn}` : ''}</p>
      {d.description && <p style={{ whiteSpace: 'pre-line' }}>{d.description}</p>}

      <section className="panel"><h2>Ficheiros</h2>
        <table className="table" data-testid="admin-formats"><thead><tr><th>Formato</th><th>Estado</th><th>Metadados extraídos</th></tr></thead><tbody>
          {d.formats.map((f, i) => <tr key={i}><td>{f.format} v{f.version_number}{f.is_current && ' ✓'}</td><td><Status s={f.status} label={STATUS_PT[f.status] ?? f.status} /></td>
            <td>{f.rejection_reason ? f.rejection_reason : [f.metadata.title && `título “${f.metadata.title}”`, f.metadata.language && `idioma ${f.metadata.language}`, `${(f.size_bytes / 1024).toFixed(0)} KB`].filter(Boolean).join(' · ')}</td></tr>)}</tbody></table></section>

      <section className="panel"><h2>Preços</h2><p>{d.prices.length ? d.prices.map((p) => money(p.amount_minor, p.currency)).join(' · ') : 'Sem preços.'}</p></section>

      <section className="panel"><h2>Direitos e contrato</h2>
        {d.contracts.map((c) => <p key={c.id} data-testid="contract">{STATUS_PT[c.status] ?? c.status} · desde {dateFmt(c.start_at)} · plataforma {(c.commission_bps / 100).toFixed(0)} % · {(c.territories ?? []).map((t) => `${t.permission_type === 'DENY' ? '✕' : ''}${t.country_code}`).join(', ')}</p>)}
        {!active && (
          <form className="wide" action={createContractAction}>
            <p className="alert warn">Sem contrato ativo: não é possível publicar. Registe o contrato assinado com a editora.</p>
            <input type="hidden" name="id" value={d.id} />
            <div className="row"><label>Comissão da plataforma (%)<input name="platform_pct" defaultValue="30" required inputMode="decimal" /></label><label>Início<input name="start_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label></div>
            <label>Territórios de venda (ISO separados por vírgula; WW = mundo)<input name="sell" defaultValue="WW" required /></label>
            <label>Territórios excluídos (opcional)<input name="deny" placeholder="KP, IR" /></label>
            <button type="submit">Registar contrato</button>
          </form>)}</section>

      <section className="panel"><h2>Decisão</h2>
        {['IN_REVIEW', 'SUSPENDED'].includes(d.status) && (
          <form action={approveBookAction} style={{ marginBottom: 14 }}><input type="hidden" name="id" value={d.id} /><button type="submit" data-testid="approve">{d.status === 'SUSPENDED' ? 'Repor à venda' : 'Aprovar e publicar'}</button>
            <span className="muted"> Exige contrato ativo, preço e um ficheiro válido.</span></form>)}
        {d.status === 'IN_REVIEW' && (
          <form className="wide" action={rejectBookAction}><input type="hidden" name="id" value={d.id} />
            <label>Devolver à editora — motivo (visível para ela)<textarea name="reason" required minLength={3} /></label><button className="secondary" type="submit" data-testid="reject">Devolver</button></form>)}
        {d.status === 'PUBLISHED' && (
          <form className="wide" action={suspendBookAction}><input type="hidden" name="id" value={d.id} />
            <label>Suspender a venda — motivo<textarea name="reason" required minLength={3} /></label><button className="secondary" type="submit">Suspender</button>
            <p className="muted">Quem já comprou mantém o acesso: o direito de leitura é permanente.</p></form>)}
      </section>

      <section className="panel"><h2>Histórico</h2>
        <ul>{d.history.map((h, i) => <li key={i}>{dateFmt(h.created_at)} — <code>{h.action}</code> ({h.actor_type}){h.reason ? `: ${h.reason}` : ''}</li>)}</ul></section>
    </>);
}
