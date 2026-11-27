import { ADMIN_TABS, Denied, Notice, Tabs } from '@/components/PortalChrome';
import { safe } from '@/lib/api';
import { decideRefundAction } from '@/lib/portal-actions';
import { dateFmt, money } from '@/lib/format';

export const dynamic = 'force-dynamic'; export const metadata = { title: 'Reembolsos' };
interface R { id: string; amount_minor: number; currency: string; reason: string; created_at: string; customer_email: string; title: string; is_duplicate: boolean; entitlement_status: string | null; order_id: string }

export default async function Refunds({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const q = await searchParams; const r = await safe<R[]>('/admin/refunds', '/admin/refunds');
  return (<><h1>Reembolsos por decidir</h1><Tabs items={ADMIN_TABS} current="/admin/refunds" /><Notice error={q.error} ok={q.ok} />
    <p className="muted">Decidir reembolsos exige MFA recente: se a plataforma o pedir, introduza o código da app autenticadora no campo «Código MFA».</p>
    {!r.ok ? <Denied {...r} /> : r.data.length === 0 ? <p className="alert warn">Nenhum pedido pendente.</p> : r.data.map((x) => (
      <section className="panel" key={x.id} data-testid="refund">
        <h2>{x.title} — {money(x.amount_minor, x.currency)} {x.is_duplicate && <span className="badge wait">compra duplicada</span>}</h2>
        <p className="muted">{x.customer_email} · {dateFmt(x.created_at)} · direito: {x.entitlement_status ?? '—'}</p><p>“{x.reason}”</p>
        <form className="wide" action={decideRefundAction}>
          <input type="hidden" name="id" value={x.id} />
          <label>Motivo da decisão (fica no registo de auditoria)<input name="reason" required minLength={3} /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="revoke" style={{ width: 'auto' }} /> Revogar também o direito de leitura</label>
          <label>Base legal/contratual (obrigatória se revogar)<input name="legal_basis" /></label>
          <label>Código MFA<input name="mfa_code" inputMode="numeric" autoComplete="one-time-code" maxLength={12} /></label>
          <div className="row"><button type="submit" name="decision" value="APPROVE">Aprovar</button><button className="secondary" type="submit" name="decision" value="REJECT">Rejeitar</button></div>
        </form></section>))}</>);
}
