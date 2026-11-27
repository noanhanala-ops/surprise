import Link from 'next/link';
import { ADMIN_TABS, Denied, Notice, Status, Tabs } from '@/components/PortalChrome';
import { safe } from '@/lib/api';
import { STATUS_PT } from '@/lib/format';

export const dynamic = 'force-dynamic'; export const metadata = { title: 'Revisão de livros' };
const STATUSES = ['IN_REVIEW', 'PUBLISHED', 'SUSPENDED', 'DRAFT'];
export default async function Reviews({ searchParams }: { searchParams: Promise<{ status?: string; error?: string; ok?: string }> }) {
  const q = await searchParams; const status = STATUSES.includes(q.status ?? '') ? q.status! : 'IN_REVIEW';
  const r = await safe<{ id: string; title: string; publisher: string; language_code: string; has_contract: boolean; prices: number }[]>(`/admin/books?status=${status}`, '/admin/reviews');
  return (<><h1>Livros</h1><Tabs items={ADMIN_TABS} current="/admin/reviews" /><Notice error={q.error} ok={q.ok} />
    <p>{STATUSES.map((s) => <Link key={s} href={`/admin/reviews?status=${s}`} className={s === status ? 'btn' : 'btn secondary'} style={{ marginRight: 6 }}>{STATUS_PT[s]}</Link>)}</p>
    {!r.ok ? <Denied {...r} /> : r.data.length === 0 ? <p className="alert warn">Nenhum livro neste estado.</p> : (
      <table className="table" data-testid="review-list"><thead><tr><th>Título</th><th>Editora</th><th>Idioma</th><th>Contrato</th><th>Preços</th></tr></thead><tbody>
        {r.data.map((b) => <tr key={b.id}><td><Link href={`/admin/reviews/${b.id}`}>{b.title}</Link></td><td>{b.publisher}</td><td>{b.language_code}</td><td>{b.has_contract ? <Status s="ACTIVE" label="Sim" /> : <Status s="PENDING" label="Falta" />}</td><td>{b.prices}</td></tr>)}</tbody></table>)}</>);
}
