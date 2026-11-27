import { redirect } from 'next/navigation';
import { authed } from '@/lib/api';
import { sandboxPayAction } from '@/lib/actions';
import { SANDBOX } from '@/lib/config';
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
      {SANDBOX && payment ? (
        <form action={sandboxPayAction}>
          <input type="hidden" name="payment_id" value={payment} />
          <p className="alert warn">Modo sandbox: nenhum dinheiro real é movido. O botão abaixo faz o fornecedor simulado confirmar o pagamento por webhook assinado — o mesmo caminho que um fornecedor real usaria.</p>
          <button type="submit">Simular pagamento aprovado</button>
        </form>
      ) : <p className="alert warn">A aguardar confirmação do pagamento. O livro aparece na sua biblioteca assim que o fornecedor confirmar.</p>}
    </>
  );
}
