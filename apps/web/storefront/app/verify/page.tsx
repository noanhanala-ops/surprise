import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export const metadata = { title: 'Verificar e-mail' };
export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect('/login?error=' + encodeURIComponent('Link de verificação inválido.'));
  try { await api('/auth/verify-email', { token: null, body: { token } }); }
  catch (e) { redirect('/login?error=' + encodeURIComponent(e instanceof ApiError ? 'Link de verificação inválido ou expirado.' : 'Erro inesperado.')); }
  redirect('/login?verified=1');
}
