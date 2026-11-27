export function money(minor: number, currency: string, locale = 'pt-PT') {
  const f = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = f.resolvedOptions().maximumFractionDigits ?? 2; // JPY=0, KWD=3…
  return f.format(minor / 10 ** digits);
}
/** Só caminhos locais (evita open-redirect via ?next=). */
export const safeNext = (n?: string | null) => (n && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : '/');
