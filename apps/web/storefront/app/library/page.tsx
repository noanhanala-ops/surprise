import Link from 'next/link';
import { authed } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'A minha biblioteca' };
interface Item { entitlement_id: string; edition_id: string; title: string; slug: string; formats: string[]; progress_percent: number }

export default async function Library({ searchParams }: { searchParams: Promise<{ purchased?: string; error?: string }> }) {
  const q = await searchParams; const items = await authed<Item[]>('/library', '/library');
  return (
    <>
      <h1>A minha biblioteca</h1>
      {q.purchased && <p className="alert ok" role="status">Compra concluída. O livro é seu, para sempre.</p>}
      {q.error && <p className="alert err" role="alert">{q.error}</p>}
      {items.length === 0 ? <p className="alert warn">Ainda não tem livros. <Link href="/">Explore a loja.</Link></p> : (
        <ul className="grid">{items.map((b) => (
          <li key={b.entitlement_id}><Link className="card" href={`/read/${b.edition_id}`}>
            <div className="cover" aria-hidden>{b.title.trim().charAt(0).toUpperCase()}</div>
            <span className="meta"><span className="title">{b.title}</span><span>{b.formats.map((f) => <span className="chip" key={f}>{f}</span>)}</span>
              <span className="muted">{Math.round(b.progress_percent)}% lido</span><span className="bar"><i style={{ width: `${b.progress_percent}%` }} /></span></span>
          </Link></li>))}</ul>)}
    </>
  );
}
