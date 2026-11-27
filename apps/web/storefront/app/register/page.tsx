import Link from 'next/link';
import { registerAction } from '@/lib/actions';

export const metadata = { title: 'Criar conta' };
export default async function Register({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <h1>Criar conta</h1>
      {error && <p className="alert err" role="alert">{error}</p>}
      <form className="stack" action={registerAction}>
        <label>Nome<input name="display_name" required maxLength={100} autoComplete="name" /></label>
        <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
        <label>Palavra-passe (mín. 12 caracteres)<input name="password" type="password" required minLength={12} autoComplete="new-password" /></label>
        <label>País (código ISO, ex.: MZ, PT, ZA)<input name="country_code" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" defaultValue="MZ" /></label>
        <button type="submit">Criar conta</button>
      </form>
      <p className="muted">Já tem conta? <Link href="/login">Entrar</Link></p>
    </>
  );
}
