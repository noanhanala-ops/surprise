import { Denied, PUBLISHER_TABS, Status, Tabs } from '@/components/PortalChrome';
import { safe } from '@/lib/api';
import { dateFmt, STATUS_PT } from '@/lib/format';

export const dynamic = 'force-dynamic'; export const metadata = { title: 'Contratos' };
export default async function Contracts() {
  const r = await safe<{ id: string; title: string; status: string; start_at: string; end_at: string | null; commission_bps: number; territories: { country_code: string; permission_type: string }[] | null }[]>('/publisher/contracts', '/publisher/contracts');
  return (<><h1>Contratos de direitos</h1><Tabs items={PUBLISHER_TABS} current="/publisher/contracts" />
    {!r.ok ? <Denied {...r} /> : r.data.length === 0 ? <p className="alert warn">Sem contratos.</p> : (
      <table className="table"><thead><tr><th>Livro</th><th>Estado</th><th>Vigência</th><th className="num">Plataforma</th><th>Territórios</th></tr></thead><tbody>
        {r.data.map((c) => <tr key={c.id}><td>{c.title}</td><td><Status s={c.status} label={STATUS_PT[c.status] ?? c.status} /></td><td>{dateFmt(c.start_at)} → {c.end_at ? dateFmt(c.end_at) : 'sem fim'}</td><td className="num">{(c.commission_bps / 100).toFixed(0)} %</td>
          <td>{(c.territories ?? []).map((t) => <span className={`badge ${t.permission_type === 'DENY' ? 'bad' : 'ok'}`} key={t.country_code} style={{ marginRight: 4 }}>{t.permission_type === 'DENY' ? '✕ ' : ''}{t.country_code}</span>)}</td></tr>)}</tbody></table>)}</>);
}
