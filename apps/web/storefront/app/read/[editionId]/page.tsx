import Link from 'next/link';
import { redirect } from 'next/navigation';
import ReaderLoader from '@/components/ReaderLoader';
import { api, ApiError, authed } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'A ler' };
interface Access { format: string; manifest_url: string | null; content_url: string }
interface Progress { locator: any; progress_percent: number; version: number }

export default async function Read({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params; const next = `/read/${editionId}`;
  let access: Access;
  try { access = await authed<Access>(`/library/${editionId}/access`, next); }
  catch (e) { if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return <p className="alert err">Não tem acesso a este livro. <Link href="/">Ver a loja</Link></p>; throw e; }
  if (!access.manifest_url) return <p className="alert warn">O formato {access.format} ainda não está disponível no leitor web. <Link href="/library">Voltar à biblioteca</Link></p>;

  const lib = await authed<{ edition_id: string; title: string }[]>('/library', next);
  const title = lib.find((l) => l.edition_id === editionId)?.title ?? 'Livro';
  const progress = await api<Progress>(`/reading/${editionId}/progress`).catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; });
  const bookmarks = await api<{ bookmarks: { id: string; locator: any; title: string | null; created_at: string }[] }>(`/reading/${editionId}/annotations`);
  const prefs = await api<{ theme?: string; font_size?: number }>('/reading/preferences').catch(() => ({}));
  if (!lib.some((l) => l.edition_id === editionId)) redirect('/library');
  return <ReaderLoader editionId={editionId} title={title} manifestUrl={access.manifest_url} progress={progress} bookmarks={bookmarks.bookmarks} prefs={prefs} />;
}
