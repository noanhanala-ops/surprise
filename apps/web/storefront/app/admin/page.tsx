import Link from 'next/link';
import { ADMIN_TABS, Denied, Tabs } from '@/components/PortalChrome';
import { safe } from '@/lib/api';

export const dynamic = 'force-dynamic'; export const metadata = { title: 'Administração' };
export default async function AdminHome() {
  const [pubs, books, refunds] = await Promise.all([safe<any[]>('/admin/publishers', '/admin'), safe<any[]>('/admin/books?status=IN_REVIEW', '/admin'), safe<any[]>('/admin/refunds', '/admin')]);
  const denied = [pubs, books, refunds].find((r) => !r.ok);
  const n = (r: typeof pubs) => (r.ok ? r.data.length : '—');
  return (<><h1>Administração</h1><Tabs items={ADMIN_TABS} current="/admin" />
    {denied && !denied.ok && <Denied {...denied} />}
    <div className="stats">
      <Link href="/admin/publishers" className="stat" data-testid="stat-publishers"><b>{n(pubs)}</b>editoras por aprovar</Link>
      <Link href="/admin/reviews" className="stat" data-testid="stat-reviews"><b>{n(books)}</b>livros em revisão</Link>
      <Link href="/admin/refunds" className="stat" data-testid="stat-refunds"><b>{n(refunds)}</b>reembolsos por decidir</Link>
    </div></>);
}
