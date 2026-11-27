import Link from 'next/link';
import { Denied, Notice, PUBLISHER_TABS, Status, Tabs } from '@/components/PortalChrome';
import { authed, safe } from '@/lib/api';
import { registerPublisherAction } from '@/lib/portal-actions';
import { STATUS_PT } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Portal da editora' };
interface Pub { id: string; display_name: string; status: string; role: string }
interface Book { edition_id: string; title: string; slug: string; status: string; language_code: string }

export default async function PublisherHome({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const q = await searchParams; const me = await safe<Pub[]>('/publisher/me', '/publisher');
  if (!me.ok) return <Denied {...me} />;
  if (me.data.length === 0) return (
    <>
      <h1>Publicar na loja</h1><p className="muted">Registe a sua editora (ou como autor independente). A administração valida o pedido antes de poder publicar.</p>
      <Notice error={q.error} ok={q.ok} />
      <form className="wide" action={registerPublisherAction}>
        <label>Nome legal<input name="legal_name" required minLength={2} /></label>
        <label>Nome público<input name="display_name" required minLength={2} /></label>
        <label>País (ISO)<input name="country_code" required maxLength={2} minLength={2} defaultValue="MZ" /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="individual" style={{ width: 'auto' }} /> Sou autor independente</label>
        <button type="submit">Pedir registo</button>
      </form>
    </>);
  const pub = me.data[0];
  if (pub.status !== 'ACTIVE') return (<><h1>{pub.display_name}</h1><Notice error={q.error} ok={q.ok} /><p className="alert warn" data-testid="publisher-pending">Estado: <Status s={pub.status} label={STATUS_PT[pub.status] ?? pub.status} />. Ainda não pode publicar: aguarde a aprovação da administração.</p></>);
  const books = await authed<Book[]>('/publisher/books', '/publisher');
  return (
    <>
      <h1>{pub.display_name}</h1><Tabs items={PUBLISHER_TABS} current="/publisher" /><Notice error={q.error} ok={q.ok} />
      <p><Link className="btn" href="/publisher/books/new">Novo livro</Link></p>
      {books.length === 0 ? <p className="alert warn">Ainda não tem livros.</p> : (
        <table className="table"><thead><tr><th>Título</th><th>Idioma</th><th>Estado</th></tr></thead><tbody>
          {books.map((b) => <tr key={b.edition_id}><td><Link href={`/publisher/books/${b.edition_id}`}>{b.title}</Link></td><td>{b.language_code}</td><td><Status s={b.status} label={STATUS_PT[b.status] ?? b.status} /></td></tr>)}
        </tbody></table>)}
    </>);
}
