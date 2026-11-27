import Link from 'next/link';
import { forgotPasswordAction } from '@/lib/actions';
import { SANDBOX } from '@/lib/config';

export const metadata = { title: 'Recuperar palavra-passe' };
export default async function Forgot({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string; sandbox_link?: string }> }) {
  const q = await searchParams;
  return (<>
    <h1>Recuperar palavra-passe</h1>
    {q.error && <p className="alert err" role="alert">{q.error}</p>}
    {q.sent ? (<>
      <p className="alert ok" role="status" data-testid="forgot-sent">Se existir uma conta com esse e-mail, enviámos um link para definir uma nova palavra-passe (válido por 1 hora).</p>
      {SANDBOX && q.sandbox_link?.startsWith('/reset-password') && <p className="alert warn" data-testid="sandbox-link">Modo sandbox (sem envio real de e-mail): <Link href={q.sandbox_link}>abrir o link do e-mail</Link></p>}
    </>) : (
      <form className="stack" action={forgotPasswordAction}>
        <label>E-mail da conta<input name="email" type="email" required autoComplete="email" /></label>
        <button type="submit">Enviar link</button>
      </form>)}
    <p className="muted"><Link href="/login">Voltar a entrar</Link></p>
  </>);
}
