import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { currentUser } from '@/lib/api';
import { logoutAction } from '@/lib/actions';
import { SANDBOX } from '@/lib/config';

export const metadata: Metadata = { title: { default: 'Livraria Digital', template: '%s · Livraria Digital' }, description: 'Compre uma vez, leia para sempre.' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="pt">
      <body>
        <header className="top"><div>
          <Link href="/" className="logo">📚 Livraria Digital{SANDBOX && <span className="sandbox">sandbox</span>}</Link>
          <nav><Link href="/">Loja</Link><Link href="/library">A minha biblioteca</Link>{user && <Link href="/publisher">Publicar</Link>}{user?.is_admin && <Link href="/admin">Administração</Link>}</nav>
          {user ? (
            <form action={logoutAction} style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Link href="/account/security" className="muted">{user.display_name}</Link><button className="secondary" type="submit">Sair</button></form>
          ) : (<><Link href="/login">Entrar</Link><Link className="btn" href="/register">Criar conta</Link></>)}
        </div></header>
        <main>{children}</main>
        <footer>Compra individual · acesso permanente à edição adquirida</footer>
      </body>
    </html>
  );
}
