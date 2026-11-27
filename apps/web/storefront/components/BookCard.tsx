import Link from 'next/link';
import { money } from '@/lib/format';

export interface BookSummary { edition_id: string; slug: string; title: string; formats: string[]; price: { amount_minor: number; currency: string } | null; cover_url: string | null; language_code: string }

export function Cover({ title, url }: { title: string; url: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className="cover" src={url} alt={`Capa de ${title}`} loading="lazy" /> : <div className="cover" aria-hidden>{title.trim().charAt(0).toUpperCase()}</div>;
}

export default function BookCard({ b }: { b: BookSummary }) {
  return (
    <li><Link className="card" href={`/books/${b.slug}`}>
      <Cover title={b.title} url={b.cover_url} />
      <span className="meta">
        <span className="title">{b.title}</span>
        <span>{b.formats.map((f) => <span className="chip" key={f}>{f}</span>)}</span>
        <span className="price">{b.price ? money(b.price.amount_minor, b.price.currency) : 'Indisponível'}</span>
      </span>
    </Link></li>
  );
}
