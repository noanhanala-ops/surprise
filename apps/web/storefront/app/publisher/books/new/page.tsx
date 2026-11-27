import { Notice } from '@/components/PortalChrome';
import { authed } from '@/lib/api';
import { createBookAction } from '@/lib/portal-actions';

export const metadata = { title: 'Novo livro' };
export default async function NewBook({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const q = await searchParams; await authed('/publisher/me', '/publisher/books/new');
  return (
    <>
      <h1>Novo livro</h1><Notice error={q.error} />
      <form className="wide" action={createBookAction}>
        <label>Título<input name="title" required maxLength={300} /></label>
        <label>Descrição<textarea name="description" maxLength={10000} /></label>
        <div className="row"><label>Idioma (ex.: pt, en)<input name="language_code" required defaultValue="pt" pattern="[a-z]{2,3}(-[A-Za-z0-9]{2,8})*" /></label><label>ISBN (opcional)<input name="isbn" pattern="[0-9X\-]{10,17}" /></label></div>
        <fieldset className="panel"><legend>Preços (deixe em branco as moedas que não vende)</legend>
          <div className="row"><label>USD<input name="price_USD" inputMode="decimal" placeholder="9,99" /></label><label>MZN<input name="price_MZN" inputMode="decimal" placeholder="640,00" /></label><label>EUR<input name="price_EUR" inputMode="decimal" placeholder="8,99" /></label></div>
        </fieldset>
        <button type="submit">Criar rascunho</button>
      </form>
    </>);
}
