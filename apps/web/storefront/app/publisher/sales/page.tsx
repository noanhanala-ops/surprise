import { Denied, PUBLISHER_TABS, Tabs } from '@/components/PortalChrome';
import { safe } from '@/lib/api';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic'; export const metadata = { title: 'Vendas' };
export default async function Sales() {
  const r = await safe<{ edition_id: string; title: string; currency: string; units: number; gross_minor: number; refunded_units: number }[]>('/publisher/sales', '/publisher/sales');
  return (<><h1>Vendas</h1><Tabs items={PUBLISHER_TABS} current="/publisher/sales" />
    {!r.ok ? <Denied {...r} /> : r.data.length === 0 ? <p className="alert warn">Ainda não há vendas.</p> : (
      <table className="table"><thead><tr><th>Livro</th><th className="num">Unidades</th><th className="num">Reembolsadas</th><th className="num">Receita bruta</th></tr></thead><tbody>
        {r.data.map((s) => <tr key={s.edition_id + s.currency}><td>{s.title}</td><td className="num">{s.units}</td><td className="num">{s.refunded_units}</td><td className="num">{money(s.gross_minor, s.currency)}</td></tr>)}</tbody></table>)}</>);
}
