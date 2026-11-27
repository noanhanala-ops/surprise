import { ADMIN_TABS, Denied, Notice, Tabs } from '@/components/PortalChrome';
import { safe } from '@/lib/api';
import { approvePublisherAction } from '@/lib/portal-actions';
import { dateFmt } from '@/lib/format';

export const dynamic = 'force-dynamic'; export const metadata = { title: 'Editoras por aprovar' };
export default async function AdminPublishers({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const q = await searchParams; const r = await safe<{ id: string; legal_name: string; display_name: string; country_code: string; owner_email: string | null; is_individual_author: boolean; created_at: string }[]>('/admin/publishers', '/admin/publishers');
  return (<><h1>Editoras por aprovar</h1><Tabs items={ADMIN_TABS} current="/admin/publishers" /><Notice error={q.error} ok={q.ok} />
    {!r.ok ? <Denied {...r} /> : r.data.length === 0 ? <p className="alert warn">Nenhuma editora pendente.</p> : (
      <table className="table" data-testid="pending-publishers"><thead><tr><th>Editora</th><th>Nome legal</th><th>País</th><th>Responsável</th><th>Pedido</th><th /></tr></thead><tbody>
        {r.data.map((p) => <tr key={p.id}><td>{p.display_name}{p.is_individual_author && <span className="badge"> autor</span>}</td><td>{p.legal_name}</td><td>{p.country_code}</td><td>{p.owner_email}</td><td>{dateFmt(p.created_at)}</td>
          <td><form action={approvePublisherAction}><input type="hidden" name="id" value={p.id} /><button type="submit" aria-label={`Aprovar ${p.display_name}`}>Aprovar</button></form></td></tr>)}</tbody></table>)}</>);
}
