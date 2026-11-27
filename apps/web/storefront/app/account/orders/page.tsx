import Link from 'next/link';
import { ACCOUNT_TABS, Notice, Status, Tabs } from '@/components/PortalChrome';
import { authed } from '@/lib/api';
import { requestRefundAction } from '@/lib/portal-actions';
import { dateFmt, money } from '@/lib/format';

export const dynamic = 'force-dynamic'; export const metadata = { title: 'As minhas encomendas' };
interface Item { id: string; edition_id: string; title: string; slug: string; unit_price_minor: number; refund_status: string | null; entitlement_status: string | null }
interface Order { id: string; status: string; currency: string; total_minor: number; created_at: string; items: Item[] }
const ORDER_PT: Record<string, string> = { DRAFT: 'Por pagar', PENDING_PAYMENT: 'A aguardar pagamento', PAID: 'Paga', FULFILLED: 'Concluída', PARTIALLY_REFUNDED: 'Reembolso parcial', REFUNDED: 'Reembolsada', CANCELLED: 'Cancelada', FAILED: 'Falhada' };
const REFUND_PT: Record<string, string> = { REQUESTED: 'Reembolso pedido', APPROVED: 'Reembolso aprovado', PROCESSING: 'Reembolso em curso', COMPLETED: 'Reembolsado', REJECTED: 'Reembolso recusado', FAILED: 'Reembolso falhou' };
const REFUNDABLE = ['PAID', 'FULFILLED', 'PARTIALLY_REFUNDED'];

export default async function Orders({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const q = await searchParams; const orders = await authed<Order[]>('/orders?limit=50', '/account/orders');
  return (<><h1>A minha conta</h1><Tabs items={ACCOUNT_TABS} current="/account/orders" /><Notice error={q.error} ok={q.ok} />
    {orders.length === 0 ? <p className="alert warn">Ainda não fez compras. <Link href="/">Explore a loja.</Link></p> : orders.map((o) => (
      <section className="panel" key={o.id} data-testid="order">
        <h2>{money(o.total_minor, o.currency)} <Status s={o.status} label={ORDER_PT[o.status] ?? o.status} /></h2>
        <p className="muted">Encomenda {o.id.slice(0, 8)} · {dateFmt(o.created_at)}</p>
        <table className="table"><tbody>{o.items.map((i) => {
          const canAsk = REFUNDABLE.includes(o.status) && (!i.refund_status || i.refund_status === 'REJECTED');
          return (<tr key={i.id}><td><strong>{i.title}</strong><br /><span className="muted">{money(i.unit_price_minor, o.currency)}</span></td>
            <td>{i.refund_status ? <Status s={i.refund_status} label={REFUND_PT[i.refund_status] ?? i.refund_status} /> : i.entitlement_status === 'ACTIVE' ? <Link href={`/read/${i.edition_id}`}>Ler</Link> : <span className="muted">—</span>}</td>
            <td>{canAsk && (
              <details><summary>Pedir reembolso</summary>
                <form className="stack" action={requestRefundAction} style={{ marginTop: 8 }}>
                  <input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="item_id" value={i.id} />
                  <label>Motivo<textarea name="reason" required minLength={3} maxLength={2000} /></label>
                  <button type="submit">Enviar pedido</button>
                  <p className="muted">A decisão segue as regras de reembolso aplicáveis ao seu país. Se for aprovado com revogação, o livro deixa de estar na biblioteca.</p>
                </form></details>)}</td></tr>);
        })}</tbody></table>
      </section>))}</>);
}
