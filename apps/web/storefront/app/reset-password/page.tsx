import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resetPasswordAction } from '@/lib/actions';

export const metadata = { title: 'Nova palavra-passe' };
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const q = await searchParams; if (!q.token) redirect('/forgot-password');
  return (<>
    <h1>Definir nova palavra-passe</h1>
    {q.error && <p className="alert err" role="alert">{q.error}</p>}
    <form className="stack" action={resetPasswordAction}>
      <input type="hidden" name="token" value={q.token} />
      <label>Nova palavra-passe (mín. 12 caracteres)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
      <label>Repita a palavra-passe<input name="confirm" type="password" required minLength={12} autoComplete="new-password" /></label>
      <button type="submit">Guardar</button>
    </form>
    <p className="muted">Por segurança, todas as sessões abertas serão terminadas. Se tiver verificação em dois passos, continuará a ser pedida ao entrar.</p>
    <p className="muted"><Link href="/login">Cancelar</Link></p>
  </>);
}
