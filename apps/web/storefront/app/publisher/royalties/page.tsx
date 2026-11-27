import { Denied, PUBLISHER_TABS, Tabs } from '@/components/PortalChrome';
import { safe } from '@/lib/api';
import { dateFmt, money } from '@/lib/format';

export const dynamic = 'force-dynamic'; export const metadata = { title: 'Royalties' };
interface R { balances: { currency: string; accrued_minor: number }[]; ledger: { id: string; title: string; currency: string; eligible_minor: number; percentage_bps: number; amount_minor: number; adjustments_minor: number; created_at: string }[] }
export default async function Royalties() {
  const r = await safe<R>('/publisher/royalties', '/publisher/royalties');
  return (<><h1>Royalties</h1><Tabs items={PUBLISHER_TABS} current="/publisher/royalties" />
    {!r.ok ? <Denied {...r} /> : (<>
      <div className="stats">{r.data.balances.length === 0 ? <p className="muted">Sem saldo ainda.</p> : r.data.balances.map((b) => <div className="stat" key={b.currency} data-testid={`balance-${b.currency}`}><b>{money(b.accrued_minor, b.currency)}</b>saldo acumulado ({b.currency})</div>)}</div>
      <p className="muted">O saldo é pago em lotes, segundo o contrato, depois de reconciliação. Cada linha usa as condições vigentes na data da venda, não o preço atual.</p>
      {r.data.ledger.length > 0 && <table className="table"><thead><tr><th>Data</th><th>Livro</th><th className="num">Base</th><th className="num">%</th><th className="num">Royalty</th><th className="num">Ajustes</th></tr></thead><tbody>
        {r.data.ledger.map((l) => <tr key={l.id}><td>{dateFmt(l.created_at)}</td><td>{l.title}</td><td className="num">{money(l.eligible_minor, l.currency)}</td><td className="num">{(l.percentage_bps / 100).toFixed(0)}</td><td className="num">{money(l.amount_minor, l.currency)}</td><td className="num">{l.adjustments_minor ? money(l.adjustments_minor, l.currency) : '—'}</td></tr>)}</tbody></table>}</>)}</>);
}
