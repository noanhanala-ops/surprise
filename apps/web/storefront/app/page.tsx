import BookCard, { BookSummary } from '@/components/BookCard';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { items } = await api<{ items: BookSummary[] }>('/books?limit=60', { token: null });
  return (
    <>
      <h1>Catálogo</h1>
      <p className="muted">Compre uma vez, leia para sempre — o livro fica na sua biblioteca mesmo que saia da loja.</p>
      {items.length === 0 ? <p className="alert warn">Ainda não há livros publicados disponíveis no seu país.</p>
        : <ul className="grid">{items.map((b) => <BookCard key={b.edition_id} b={b} />)}</ul>}
    </>
  );
}
