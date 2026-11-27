import { redirect } from 'next/navigation';
import { authed } from '@/lib/api';
import { sandboxPayAction } from '@/lib/actions';
import { SANDBOX } from '@/lib/config';
import AutoRefresh from '@/components/AutoRefresh';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pagamento' };
interface Order { id: string; status: string; currency: string; total_minor: number; items: { id: string; edition_id: string; unit_price_minor: number }[] }

export default async function Checkout({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ payment?: string }> }) {
  const { orderId } = await params; const { payment } = await searchParams;
  const order = await authed<Order>(`/orders/${orderId}`, `/checkout/${orderId}`);
  if (order.status === 'FULFILLED') redirect('/library?purchased=1');
  return (
    <>
      <h1>Pagamento</h1>
      <p>Encomenda <code>{order.id.slice(0, 8)}</code> · {order.items.length} artigo(s) · <strong>{money(order.total_minor, order.currency)}</strong> · estado: {order.status}</p>
      {order.status === 'PAID' || (!SANDBOX && order.status === 'PENDING_PAYMENT') ? (
        <>
          <p className="alert warn" role="status" data-testid="confirming">{order.status === 'PAID' ? 'Pagamento recebido. A atribuir o livro à sua biblioteca…' : 'A aguardar confirmação do pagamento…'}</p>
          <AutoRefresh /> {/* o direito de leitura é atribuído de forma assíncrona (webhook → outbox → broker): esperamos por ele */}
        </>
      ) : SANDBOX && payment ? (
        <form action={sandboxPayAction}>
          <input type="hidden" name="payment_id" value={payment} /><input type="hidden" name="order_id" value={order.id} />
          <p className="alert warn">Modo sandbox: nenhum dinheiro real é movido. O botão abaixo faz o fornecedor simulado confirmar o pagamento por webhook assinado — o mesmo caminho que um fornecedor real usaria.</p>
          <button type="submit">Simular pagamento aprovado</button>
        </form>
      ) : <p className="alert err">Esta encomenda não está pendente de pagamento (estado: {order.status}).</p>}
    </>
  );
}
