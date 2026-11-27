import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { mfaVerifyAction } from '@/lib/actions';
import { COOKIE } from '@/lib/config';
import { safeNext } from '@/lib/format';

export const metadata = { title: 'Verificação em dois passos' };
export default async function MfaStep({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const q = await searchParams;
  if (!(await cookies()).get(COOKIE.mfa)) redirect('/login');
  return (
    <>
      <h1>Verificação em dois passos</h1>
      <p className="muted">Introduza o código de 6 dígitos da sua app autenticadora, ou um código de recuperação.</p>
      {q.error && <p className="alert err" role="alert">{q.error}</p>}
      <form className="stack" action={mfaVerifyAction}>
        <input type="hidden" name="next" value={safeNext(q.next)} />
        <label>Código<input name="code" inputMode="text" autoComplete="one-time-code" required minLength={6} maxLength={12} autoFocus /></label>
        <button type="submit">Verificar</button>
      </form>
    </>
  );
}
