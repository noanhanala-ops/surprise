export const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY ?? 'MZ';
// Só a variável explícita (o `next start` corre sempre com NODE_ENV=production). A API recusa arrancar em produção com SANDBOX_MODE=true.
export const SANDBOX = process.env.SANDBOX_MODE === 'true';
export const COOKIE = { access: 'drp_at', refresh: 'drp_rt', device: 'drp_dev', refreshed: 'drp_rf' } as const;
export const cookieBase = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
