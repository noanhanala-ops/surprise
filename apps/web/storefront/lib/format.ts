export function money(minor: number, currency: string, locale = 'pt-PT') {
  const f = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = f.resolvedOptions().maximumFractionDigits ?? 2; // JPY=0, KWD=3…
  return f.format(minor / 10 ** digits);
}
/** Só caminhos locais (evita open-redirect via ?next=). */
export const safeNext = (n?: string | null) => (n && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : '/');

/** "12,50" / "12.50" → 1250 (unidades menores). Devolve null se inválido. Moedas com 2 casas (USD/MZN/EUR). */
export function toMinor(input: string): number | null {
  const t = input.trim().replace(',', '.'); if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
export const STATUS_PT: Record<string, string> = { DRAFT: 'Rascunho', IN_REVIEW: 'Em revisão', APPROVED: 'Aprovada', PUBLISHED: 'Publicado', SUSPENDED: 'Suspenso', DELISTED: 'Retirado',
  PENDING: 'Pendente', ACTIVE: 'Ativa', KYC_REVIEW: 'Em verificação', TERMINATED: 'Terminada', READY: 'Válido', REJECTED: 'Rejeitado', REQUESTED: 'Pedido', COMPLETED: 'Concluído' };
export const dateFmt = (d: string | Date) => new Date(d).toLocaleDateString('pt-PT', { year: 'numeric', month: 'short', day: 'numeric' });
