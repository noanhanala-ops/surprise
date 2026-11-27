import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Cover } from '@/components/BookCard';
import { api, ApiError, currentUser } from '@/lib/api';
import { buyAction } from '@/lib/actions';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';
interface Book { edition_id: string; slug: string; title: string; description: string | null; formats: string[]; isbn: string | null; language_code: string; cover_url: string | null; price: { amount_minor: number; currency: string } | null }

export default async function BookPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params; const { error } = await searchParams;
  const book = await api<Book>(`/books/${encodeURIComponent(slug)}`, { token: null }).catch((e) => { if (e instanceof ApiError && e.status === 404) notFound(); throw e; });
  const user = await currentUser();
  const owned = user ? (await api<{ edition_id: string }[]>('/library').catch(() => [])).some((l) => l.edition_id === book.edition_id) : false;
  return (
    <div className="detail">
      <Cover title={book.title} url={book.cover_url} />
      <div>
        <h1>{book.title}</h1>
        <p>{book.formats.map((f) => <span className="chip" key={f}>{f}</span>)}<span className="chip">{book.language_code}</span>{book.isbn && <span className="chip">ISBN {book.isbn}</span>}</p>
        {error && <p className="alert err" role="alert">{error}</p>}
        <p style={{ whiteSpace: 'pre-line' }}>{book.description ?? 'Sem descrição.'}</p>
        {owned ? (<p><Link className="btn" href={`/read/${book.edition_id}`}>Ler agora</Link> <span className="muted">Já está na sua biblioteca.</span></p>)
          : book.price ? (
            <form action={buyAction}>
              <input type="hidden" name="edition_id" value={book.edition_id} /><input type="hidden" name="slug" value={book.slug} /><input type="hidden" name="currency" value={book.price.currency} />
              <p><span className="price" style={{ fontSize: '1.5rem' }}>{money(book.price.amount_minor, book.price.currency)}</span></p>
              <button type="submit">Comprar</button>
              <p className="muted">Pagamento único. Acesso permanente a esta edição.</p>
            </form>
          ) : <p className="alert warn">Preço indisponível na sua moeda.</p>}
      </div>
    </div>
  );
}
