import Link from 'next/link';

export function Tabs({ items, current }: { items: [string, string][]; current: string }) {
  return <nav className="tabs" aria-label="Secções">{items.map(([href, label]) => <Link key={href} href={href} aria-current={current === href ? 'page' : undefined}>{label}</Link>)}</nav>;
}
export const PUBLISHER_TABS: [string, string][] = [['/publisher', 'Livros'], ['/publisher/sales', 'Vendas'], ['/publisher/royalties', 'Royalties'], ['/publisher/contracts', 'Contratos']];
export const ADMIN_TABS: [string, string][] = [['/admin', 'Resumo'], ['/admin/publishers', 'Editoras'], ['/admin/reviews', 'Revisão de livros'], ['/admin/refunds', 'Reembolsos']];

export function Notice({ error, ok }: { error?: string; ok?: string }) {
  return <>{error && <p className="alert err" role="alert">{error}</p>}{ok && <p className="alert ok" role="status">{ok}</p>}</>;
}

/** Erro de API num portal: sem permissões / MFA em falta / outro. */
export function Denied({ status, code, message }: { status: number; code?: string; message: string }) {
  if (code === 'MFA_REQUIRED') return <p className="alert warn" role="alert">A administração exige verificação em dois passos. <Link href="/account/security">Ativar o MFA</Link> e depois entre de novo.</p>;
  if (status === 403) return <p className="alert err" role="alert">Não tem permissões para ver esta secção.{message ? ` (${message})` : ''}</p>;
  return <p className="alert err" role="alert">{message}</p>;
}

export const Status = ({ s, label }: { s: string; label: string }) =>
  <span className={`badge ${['PUBLISHED', 'ACTIVE', 'READY', 'COMPLETED'].includes(s) ? 'ok' : ['REJECTED', 'SUSPENDED', 'FAILED'].includes(s) ? 'bad' : ['IN_REVIEW', 'PENDING', 'REQUESTED'].includes(s) ? 'wait' : ''}`}>{label}</span>;
