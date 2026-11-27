import Link from 'next/link';
import { loginAction } from '@/lib/actions';
import { safeNext } from '@/lib/format';

export const metadata = { title: 'Entrar' };
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; registered?: string; verified?: string; reset?: string }> }) {
  const q = await searchParams;
  return (
    <>
      <h1>Entrar</h1>
      {q.error && <p className="alert err" role="alert">{q.error}</p>}
      {q.registered && <p className="alert ok">Conta criada. Verifique o seu e-mail para ativar a conta.</p>}
      {q.verified && <p className="alert ok">E-mail verificado. Já pode entrar.</p>}
      {q.reset && <p className="alert ok" role="status">Palavra-passe alterada. Entre com a nova palavra-passe.</p>}
      <form className="stack" action={loginAction}>
        <input type="hidden" name="next" value={safeNext(q.next)} />
        <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
        <label>Palavra-passe<input name="password" type="password" required autoComplete="current-password" /></label>
        <button type="submit">Entrar</button>
      </form>
      <p className="muted"><Link href="/forgot-password">Esqueceu a palavra-passe?</Link></p>
      <p className="muted">Ainda não tem conta? <Link href="/register">Criar conta</Link></p>
    </>
  );
}
